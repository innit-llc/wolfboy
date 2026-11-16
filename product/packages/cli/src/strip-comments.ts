/**
 * Comment removal for guard and corroboration evaluation.
 *
 * `guard_missing` and `also_in_file` are tested against whole-file content. Until 2026-07-27 that
 * content included comments, and adversarial review demonstrated the consequence four separate
 * times in one day, on four different rules:
 *
 *   // TODO: persist consented_at server-side once the consent API exists
 *   // accountDeletion flow does not exist; people email us and we do it by hand
 *   // TODO: add a clearConsent() helper before the next release
 *   <!-- TODO: we still have no vulnerability disclosure policy. -->
 *
 * Each of those lines silenced its rule across the whole repository. **A maintainer writing down
 * that the duty is unmet was read by the engine as the duty being met.** The same asymmetry runs
 * the other way on `also_in_file`: a comment saying "nothing is ever scraped from the web" supplied
 * the `crawler` corroboration a face-scraping rule required.
 *
 * This was recorded as cross-cutting finding P2 in an internal record, written into
 * every subsequent authoring brief, and recurred anyway — because it is not fixable in a rule.
 *
 * Line count is preserved exactly: every removed character becomes a space and every newline
 * survives, so a guard's reported line number still points at the right line.
 *
 * The stripper is deliberately conservative. Where a file's language is unknown the content is
 * returned unchanged, because a wrong strip would hide real code from a guard — which is the more
 * dangerous direction: an unstripped comment can only cost a candidate the agent would have
 * reviewed, whereas hidden code can delete a guard that was genuinely discharging the duty.
 */

import { prismEmbdocSpans } from "./ruby-prism.js";

/**
 * THIS TABLE IS A GATE THAT DOES NOT RUN WHEN IT IS INCOMPLETE, AND NOBODY WAS CHECKING IT.
 *
 * An extension missing here is not "handled conservatively". It means the corroboration gate reads
 * that format's COMMENTS AS CODE — a commented-out switch opens a gate, a commented-out procedure
 * supplies a corroboration, and the finding says the opposite of what the file does. The header
 * above states the opposite risk (a wrong strip hiding real code) and it is real, but it applies to
 * formats nobody has thought of. It does not apply to a format whose fixtures this repository
 * ships.
 *
 * On 2026-08-12 the same class was found THREE TIMES IN ONE DAY, by three agents doing three
 * unrelated tasks, each of them stumbling into it rather than looking for it:
 *
 *   1. A check did not classify `.env`, so every mutant of a dotenv fixture was
 *      reported MALFORMED and the mutation gate for it silently did not run.
 *   2. THIS file did not classify `.env`, so a commented-out switch opened `eu-retention-002`'s
 *      corroboration gate (found by the independent verification of that rule).
 *   3. THIS file did not classify `.sql` or `.tf`, so a `#`-commented Terraform block and a
 *      commented-out SQL procedure each opened `eu-retention-003`'s gate — the second being the
 *      exact case `ok-migration-one-off-data-fix.sql` declares excluded (found by the independent
 *      verification of THAT rule).
 *
 * Three occurrences of one shape is a design defect, which is the same conclusion `walk.ts` reached
 * about its own allowlist on 2026-07-28. The answer here cannot be walk.ts's (invert to a denylist):
 * a stripper must know a format's comment syntax and cannot guess it. So the answer is a check —
 * a check now fails the build when any extension or bare filename used by any
 * rule's fixtures is classified by neither table and is not on an explicit, reasoned list of
 * formats that have no comment syntax at all.
 *
 * The set of names this table must cover is not "every extension in the world": `walk.ts` is a
 * denylist and reads any text file, so no closed list exists. It is "every format the rules
 * themselves claim to read", which is bounded, enumerable and now enforced.
 */
type Syntax =
  | "c-like" | "css" | "hash" | "line-hash" | "hcl" | "php" | "sql" | "markup" | "markdown"
  // Each kind's own comment rule, added 2026-11-11 (R11-E): the `hash` and `line-hash` families
  // read each of these kinds by one rule that is not the kind's own. See the note above
  // `propertiesCuts` for the mechanism (a kind may only blank where its family blanked) and the
  // source each kind's rule is read from.
  | "properties" | "yaml" | "dotenv" | "ini" | "datasource" | "toml" | "python" | "elixir"
  | "shell" | "makefile" | "perl" | "dockerfile" | "graphql" | "hjson"
  // Ruby, added 2026-09-24: `hash` plus Ruby's own block form, `=begin … =end`. See the note above
  // `blankSpans` for why it is a mode of its own rather than a member of the `hash` family, and why
  // `.py` stays `hash`.
  | "ruby"
  // Template languages, added 2026-08-19.
  // Each is `markup` (or, for Blade, `php`) PLUS the template's own comment form, composed exactly
  // the way `hcl`, `php` and `markdown` are composed above. See the note above TEMPLATE_COMMENTS for
  // which forms these are, where each was measured to occur, and what is deliberately left standing.
  //
  // EIGHT SHIPPED THAT DAY AND FIVE REMAIN: `liquid`, `slim` and `pug` were removed
  // the same day, on a re-derived count of ZERO corpus occurrences each. See above `BY_EXT`.
  | "blade" | "twig" | "handlebars" | "erb-template" | "haml"
  | "none";

const BY_EXT: Record<string, Syntax> = {
  js: "c-like", jsx: "c-like", ts: "c-like", tsx: "c-like", mjs: "c-like", cjs: "c-like",
  mts: "c-like", cts: "c-like", go: "c-like", java: "c-like", kt: "c-like", kts: "c-like",
  cs: "c-like", swift: "c-like", rs: "c-like", scala: "c-like",
  c: "c-like", h: "c-like", cc: "c-like", cpp: "c-like", hpp: "c-like", m: "c-like", mm: "c-like",
  // `.dart` and `.prisma` both write `//` and `/* */`; Prisma's `///` is a documentation form of
  // `//`. Both had fixtures in this repository and neither was classified until 2026-08-12.
  dart: "c-like", prisma: "c-like",
  // `.proto` and `.gradle`, added 2026-09-08. Both are in
  // a tool's census whitelist — so both are read on every real tree — and
  // neither table classified either, which meant every comment in them reached the corroboration
  // gates AS CODE. That is the `.env`/`.sql`/`.tf` defect of 2026-08-12 in two more formats.
  //
  // WHY `c-like` AND NOT A MODE OF THEIR OWN: protobuf's comment syntax IS C's — `//` to end of
  // line and `/* … */` — and it has no third form; `#` is not a comment in a `.proto` file, which
  // is why `hash` would be wrong here. A `.gradle` build script is Groovy, whose comment syntax is
  // also C's (`/** … */` being a documentation form of `/* … */`).
  //
  // MEASURED over the corpus on disk (170 trees) before the entries were written:
  //   `.proto`   268 files, 204 changed, 11,438 lines blanked, 0 files with an unbalanced `/*`
  //   `.gradle`  227 files, 142 changed,  2,848 lines blanked
  // The unbalanced-`/*` count is the one that matters, because an unterminated block comment is the
  // form that would blank the remainder of a file. Six `.gradle` files LOOK unbalanced to a naive
  // count and none is: every excess opener is inside a string literal (`'/app/plugins/*'`,
  // `"/META-INF/services/**"`, `excludes += '/META-INF/*'`), which `stripCLike` already tracks —
  // the largest blanked run in any of the six is the 18-line Javadoc header at line 1.
  //
  // WHAT IS NOT STRIPPED, said plainly: nothing in either format. Both write exactly the two forms
  // `stripCLike` removes. `.proto` is a format a rule needs
  // (one real tree's `history.proto`), and finding it unclassified is what opened
  // this unit.
  proto: "c-like", gradle: "c-like",
  // Ember "template tag" components (RFC 779), added 2026-08-12. A `.gjs` file is JavaScript and a
  // `.gts` file is TypeScript, at the top level, carrying one or more `<template>` blocks whose
  // bodies are Handlebars. `c-like` is therefore right about the file's own language, and this is
  // the largest single population the table was missing: 2,801 `.gjs` and 25 `.gts` files in the
  // corpus, all in one Rails forum, of which 2,752 and 25 respectively contain a `<template>` block.
  //
  // WHAT IS STRIPPED: `//` and `/* */`, anywhere in the file. 498 `.gjs` and 10 `.gts` files carry
  // the first; 336 and 22 carry the second.
  //
  // WHAT IS NOT STRIPPED, said plainly because an entry in this table otherwise reads as "this
  // format is handled": Handlebars comments — `{{! … }}` and `{{!-- … --}}` — inside a `<template>`
  // block. 129 `.gjs` and 8 `.gts` corpus files carry one (126 and 8 of them inside the surface the
  // walker actually opens; the other 3 are under `tests/`). Blanking them too was built and measured
  // on 2026-08-12 before this entry was written: it changes the guard content of exactly those 134
  // scanned files and moves **0 gate results and 0 locations** across all 56 rules, so the residue
  // is real, sized and inert in today's corpus, and a `gjs` mode was not added for it. That is the
  // same call `.tpl` made below and for the same reason — under-stripping a dialect's own form is
  // this file's conservative direction, over-stripping is not.
  //
  // ONE MEASURED SIDE EFFECT, and it is a property of `stripCLike` rather than of these formats.
  // FIXED ON 2026-08-13; the paragraph is kept because the rate it records is what sized the defect.
  // The stripper had no regex-literal state, so `final.replace(/['"]+/g, "")` left its quote
  // tracking desynchronised for the rest of the file; in `google-dfp-ad.gjs` that made a `//`
  // inside a string literal look like a line comment and shut `eu-consent-014`'s corroboration
  // gate on that one file (0 locations lost, since the rule matches nothing there). The rate was the
  // same for files this table has always classified — 11 of 2,801 `.gjs` and 19 of 3,072 `.js`/`.ts`
  // in the same repository ended inside an unterminated quote — so not classifying `.gjs` did not
  // avoid it, it only left the comments in as well. No `.gjs` or `.gts` file in the corpus has an
  // unterminated `/*`, which is the form that would blank the remainder of a file. See the note
  // above `REGEX_AFTER_CHARS` for the rule that closed this and for what it still gets wrong.
  gjs: "c-like", gts: "c-like",
  // PHP, moved out of `c-like` on 2026-08-13.
  // `c-like` is right about two of PHP's three comment
  // forms and blind to the third: `#` to end of line is a PHP comment, `stripCLike` has never known
  // that, and so every `#` comment in all 58,364 `.php` files the walker returns across the 94
  // pinned corpus trees reached the corroboration gates as if it were code — the same defect `.env`,
  // `.sql` and `.tf` each carried on 2026-08-12, this time in a format the table did classify.
  //
  // WHAT IS STRIPPED: `#` comments, plus the `//` and `/* … *​/` `c-like` already stripped. The mode
  // COMPOSES `stripCLike` rather than replacing it, exactly as `stripHcl` does.
  //
  // WHAT IS NOT STRIPPED, and it is a rule of PHP in each case rather than a shortcut: `#[` opens a
  // PHP 8 attribute and is not a comment (1,269 corpus files contain one); a `#` inside a string,
  // heredoc or nowdoc is content (322 files carry a `<<<`); a `#` outside `<?php … ?>` is HTML —
  // an id selector or a URL fragment — and 988 corpus `.php` files never open a PHP block at all.
  //
  // MEASURED BOTH WAYS over all 58,364 files: **66 files change, 424 lines are newly blanked, 0
  // lines are newly kept**, and every one of the 424 is a comment — 423 by shape, and the one that
  // is not was read: a `#`-commented-out line of code whose trailing `//` the old reader had already
  // blanked. **0 gate results flip and 0 locations move** across 576 (rule, file) pairs and the 11
  // rules that read guard content, and a positive control confirms the harness can see a flip — 200
  // of 200 shut gates open when their own rule's bad fixture is appended to the guard content.
  //
  // RE-MEASURED LATER AND THE LINE COUNT MOVED, from 465 to 424. A later change gave `stripCLike`
  // the rule that a `'` opens a string only when an unescaped `'` closes it on the same line, which
  // repairs — inside `stripCLike` itself — the desynchronisation an apostrophe in a `#` comment used
  // to cause. 41 `//` and `/* … *​/` comment lines this mode used to be credited with recovering
  // are now blanked in both engine states, so they are no longer this change's to claim. The
  // direction is unchanged: 0 newly kept, 0 defects, 66 files.
  //
  // WHY THIS IS A MODE AND NOT A BRANCH IN `stripCLike`, measured rather than argued: `c-like` is
  // shared with C, C++, Objective-C, Rust, C# and Swift, where `#include`, `#define`, `#ifndef`,
  // `#[derive]` and `#region` are CODE. A build of `stripCLike` that cuts at `#` was made on
  // 2026-08-13 to price it and it blanks **338,312 lines across 12,637 corpus files** in those
  // formats. The other obvious entry, `php: "hash"`, was built too: it changes 55,444 of the 58,364
  // `.php` files, because `hash` strips no `//` and no `/* … *​/`. Both figures are re-derived at
  // a later commit; at an earlier one they were 336,980 / 12,623 and 55,436, and both designs are rejected on
  // either reading. Both are locked by assertions in a check.
  php: "php",
  css: "css", scss: "css", sass: "css", less: "css", styl: "css",
  // `.erb` sat here as `markup` until 2026-08-19 and now has its own mode below, with the rest of
  // the template languages.
  // `rb`/`rake` were `hash` until 2026-09-24, which covered `#` and not Ruby's `=begin … =end`
  // block; see the note above `blankSpans`. `py`/`pyi` stay `hash`: a Python docstring is read as
  // code, by a decision recorded in the same note.
  // Each `hash` row below became its kind's own mode on 2026-11-11 (R11-E); see `propertiesCuts`.
  py: "python", pyi: "python", rb: "ruby", rake: "ruby", sh: "shell", bash: "shell",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", properties: "properties", ex: "elixir", exs: "elixir",
  // `.datasource` — a Tinybird data-source definition, added 2026-09-02 with a fixture
  // (`eu-dsr-008/fixtures/bad-view-events.datasource`). Its comment form is `#` to end of line, the
  // same as `.properties`/`.toml`/`.ini` above, so it joins the `hash` family rather than gaining a
  // mode. Until this entry existed `syntaxFor("x.datasource")` returned `null`, the comment-blanked
  // view equalled the raw text, and the second of `matchFires`' two tests short-circuited.
  datasource: "datasource",
  // SQL comments are `--` to end of line and `/* */`, and neither of the modes above removes `--`.
  // 23 fixtures across this repository are `.sql`.
  sql: "sql",
  // HCL/Terraform: `#` AND `//` AND `/* */` are all comments, which is why this is its own mode
  // rather than `hash`. A check chose plain `hash` for its own table on
  // 2026-08-12 and said so; that table only decides whether a mutant perturbs anything, whereas
  // this one decides whether a guard sees a comment, and leaving `//` in a `.tf` file is the same
  // hole as leaving `#` in it.
  tf: "hcl", tfvars: "hcl", hcl: "hcl",
  // `.hjson` — Human JSON, added 2026-09-03 for
  // `extension-code-001/fixtures/bad-plugin-defaults.hjson` (the shape of a real tree's
  // Human JSON defaults file). Its comment forms are `#`, `//` and `/* */` — exactly HCL's three — so
  // it joins `hcl` rather than gaining a mode. Until this entry existed the mutation harness
  // reported the format as unclassified and the guards read the fixture's own header comment as code.
  hjson: "hjson",
  // Docker treats `#` as a comment ONLY as the first non-blank character of a line; mid-line it is
  // data (`RUN curl https://x/#frag`). `hash` would cut there, which is the dangerous direction, so
  // this is the whole-line mode instead. Same reasoning as mutation-check's `line-hash` group.
  dockerfile: "dockerfile",
  // `.cfg`, `.conf`, `.graphql`, `.gql`, `.pl` and `.pm`, added 2026-09-08
  // for the reason `dockerfile` is directly above: `#` opens a comment in each of
  // them, and in each of them a mid-line `#` is DATA. All six are in a tool's
  // census whitelist and neither table classified any of them, so their comments reached the
  // corroboration gates as code.
  //
  // WHY `line-hash` AND NOT `hash`, MEASURED BOTH WAYS over the corpus on disk (170 trees) rather
  // than argued. `hash` cuts at a `#` anywhere on the line; `line-hash` cuts only when `#` is the
  // first non-blank character. Files read / changed / lines blanked / MID-LINE cuts:
  //
  //   `.cfg`      114 /  101 / 11,151 / 1,698   as `hash`      114 / 100 / 9,453 / 0   as `line-hash`
  //   `.conf`     158 /  114 /  7,839 /    96   as `hash`      158 / 112 / 7,743 / 0   as `line-hash`
  //   `.graphql`  423 /   66 /    316 /     9   as `hash`      423 /  65 /   307 / 0   as `line-hash`
  //   `.gql`       69 /    1 /      1 /     0   as `hash`       69 /   1 /     1 / 0   as `line-hash`
  //   `.pl`        19 /   19 /    329 /    47   as `hash`       19 /  18 /   282 / 0   as `line-hash`
  //   `.pm`         3 /    3 /    121 /     0   as `hash`        3 /   3 /   121 / 0   as `line-hash`
  //
  // The mid-line column is not a tie-break, it is the decision, because the lines in it were read.
  // `hash` DESTROYS CONFIGURATION VALUES in the very tree that prompted the `.cfg` entry: all 15
  // mid-line `#` occurrences under one real tree's configuration folder are data, not
  // comments — a URL template such as `/items/#id#/edit`,
  // ontology URIs ending `0.1#hasPart` and their siblings, and
  // facet separators such as `Done###entry`. `.graphql` carries the same defect
  // in a different construct: a schema file holds a documentation URL
  // whose `#section` fragment sits inside a `"""` description block. `.pl`'s 47 are
  // `#` inside Perl regex literals (`qr{^#\s*(\w+)}`,
  // a character class `[\s\#]`). Blanking any of those is over-stripping, which
  // this file's header names as the direction it does not accept; `line-hash` cannot do it.
  //
  // WHAT IS NOT STRIPPED, and it is under-stripping in each case, which is the accepted direction:
  // a trailing `# …` comment after a value. `.cfg` loses 1,698 such lines against `hash`, `.conf`
  // 96, `.graphql` 7 and `.pl` 45 — genuine comments that stay visible to a guard. They are the
  // price of the configuration, schema and Perl lines above staying visible too.
  //
  // WHY `line-hash` AND NOT `line-ini` (which also cuts a line-initial `;`): zero `.cfg` and zero
  // `.conf` files in the corpus carry a `;`-initial line, so `line-ini` would be a claim with no
  // evidence behind it, and `line-hash` keeps this table and a check in the SAME
  // family for all six — which is what that file's header promises.
  cfg: "line-hash", conf: "line-hash",
  graphql: "graphql", gql: "graphql",
  pl: "perl", pm: "perl",
  // WHAT THE 2026-09-08 AUDIT FOUND AND DID NOT ADD. That audit compared every extension used by
  // `rules/**/fixtures/` and every extension in a tool's census whitelist
  // against this table and against `STRIP_MODE_BY_EXT` in a check. Eight of the
  // thirteen gaps are the entries above. The other five are named here rather than left to be
  // rediscovered, because a table that omits a format silently is the defect this whole check
  // exists to stop:
  //
  //   `.rst`   712 corpus files. reStructuredText's comment is `..` followed by an
  //            INDENTATION-SCOPED body, which no mode in this file expresses; the marker alone is
  //            not the comment. Adding a mode is a different change from registering an extension
  //            against a mode that already exists — the call `.handlebars` records below — and it
  //            is not made here. This is the largest unclassified population left in the whitelist.
  //   `.clj`   0 corpus files. Clojure's `;`; no mode strips it.
  //   `.cljs`  0 corpus files. Likewise.
  //   `.erl`   0 corpus files. Erlang's `%`; no mode strips it.
  //   `.hs`    0 corpus files. Haskell's `--` and `{- … -}`. `sql` is `--` and `/* … */`, which is
  //            NOT Haskell, so reusing it would be a wrong claim rather than a conservative one.
  //
  // The last four are the 2026-08-19 ruling's own bar, applied rather than restated: a mode may be
  // added when a corpus file carrying its form exists, and for these four none does.
  //
  // Three fixture extensions look unclassified to a bare `BY_EXT` lookup and are not: `.eex`
  // resolves through BY_COMPOUND_EXT (`ok-…-is-not-a-routine.sql.eex` → `sql`), `Makefile` through
  // BY_BASENAME → `hash`, and `.env.example` / `env.sample` through the dotenv NAME test → `hash`.
  // `.pem`, `.example` and `.sample` are carried by `NO_COMMENT_SYNTAX` in `mutation-check.mjs`.
  html: "markup", htm: "markup", vue: "markup", svelte: "markup", astro: "markup", xml: "markup",
  // `.plist` — Apple property list, added 2026-09-03 for
  // `platform-store-002/fixtures/bad-icloud-entitlements.plist` (an entitlements file). The form
  // that appears in source trees is XML with `<!-- -->` comments, which is `markup`'s whole job
  // (measured 2026-09-03 over the corpus's 288 `.plist` files: 285 begin `<?xml`, 1 is binary, 1
  // is the old NeXT text form, 1 other); a binary plist carries NUL bytes and never reaches this
  // table (the walker's readability sniff stops it), and the NeXT text form with `/* */` comments
  // is left as it was — unstripped — which is one form short of today, not one form worse. Same
  // gap as `.hjson` above until then.
  plist: "markup",
  // Markdown, moved out of `markup` on 2026-08-13.
  // `markup` is right about a Markdown file's ONE
  // comment form — `<!-- … -->` — and blind to the construct that surrounds a quarter of the text:
  // a FENCED CODE BLOCK is quoted text, and `stripMarkup` read the `<script>` inside one as an
  // element and handed the sample's body to `stripCLike` as if it were live JavaScript.
  //
  // WHY A SEPARATE MODE RATHER THAN FENCE TRACKING INSIDE `stripMarkup`, priced rather than argued.
  // `stripMarkup` serves 22 extensions in this corpus and about 30 in the table, and in HTML, Vue,
  // Svelte and XML three backticks are ordinary text. A build that tracks fences for every markup
  // extension was made on 2026-08-13 and measured over all 82,466 `markup` files: it changes **2
  // `.html` files that this mode does not**, both of them turndown test pages carrying a literal
  // ``` line inside a `<pre>` block, and in them **5 `<!-- … -->` HTML comments stop being blanked,
  // three of which are ordinary comments in the document body** — a maintainer's comment reaching a
  // corroboration gate as if it were content, which is the asymmetry the header of this file exists
  // to close, reintroduced in a format where a fence does not exist. `contentForGuards` already
  // knows the file name, so routing costs nothing and `markupElementAt` — which
  // a check imports — keeps its signature.
  md: "markdown", markdown: "markdown", mdx: "markdown",
  // THE TEMPLATE LANGUAGES, moved out of `markup` on 2026-08-19. Until that date
  // every one of these read its OWN comment form as live code: `markup` knows `<!-- … -->` and the
  // bodies of `<script>`/`<style>`, and knows nothing about `{{-- --}}`, `{{! }}`, `{# #}`, `<%# %>`,
  // `{% comment %}`, `-#` or `//-`. The consequence was not theoretical and it is what forced this
  // change: a `.blade.php` fixture mutant was matching text inside its own `{{-- … --}}` header, so
  // the mutant reported UNRESOLVED for a reason that had nothing to do with the mutation under test.
  //
  // Each mode blanks the template's own comments FIRST and then runs the host format's existing
  // reader — `stripMarkup` for six of the eight, `stripPhp` for Blade, and nothing for Pug — exactly
  // as `hcl` composes `stripHash` and `stripCLike`. So the host half stays the code the other
  // extensions are tested on, and neither half can shift a line number.
  //
  // WHICH FORMS, AND WHERE EACH WAS SHOWN TO OCCUR before it was added — counted over `rules/**` and
  // over all 94 pinned corpus trees, counting only WELL-FORMED comments (an opener AND its own
  // closer) in the extensions where that form is the language's own syntax. A plain substring scan
  // for `{#` was tried first and is WRONG: it counts Svelte's `{#if}` (2,549 corpus files) and
  // Mustache's `{{#section}}` (1,203), neither of which is a comment.
  //
  //   `{{-- --}}` blade         fixtures 45 files / 283x   corpus    65 files / 149x
  //   `{{! }}` `{{!-- --}}` hbs fixtures 23 files / 129x   corpus 1,300 files / 3,542x
  //   `{# #}` twig             fixtures 24 files / 123x   corpus    81 files / 433x
  //   `<%# %>` erb/ejs         fixtures 47 files / 167x   corpus    52 files / 60x
  //   `-#` `/` haml            fixtures 18 files / 398x   corpus    15 files / 19x
  //
  // EIGHT MODES SHIPPED ON 2026-08-19 AND FIVE REMAIN. `liquid`, `slim` and `pug` were removed the
  // same day, on the counts in the three rows this list no longer carries: over the
  // 94 pinned trees, `{% comment %}` occurs in 0 of 52 `.liquid` files, and NO `.slim` OR `.pug`
  // FILE EXISTS AT ALL. Re-derived before the removal, with a control that rejects the near-misses
  // (`{#if}`, `{{#section}}`, `{% if %}`, `<% %>`, a Pug attribute URL's `//`): all three are 0.
  //
  // THE REASONING, because it decides what may be added here in future. Teaching this view a
  // comment syntax makes the engine SKIP that text, and skipping means detecting less — every mode
  // added here NARROWS the scanner. The project's rules forbid narrowing on a null result: "we looked and
  // found nothing is not evidence that nothing is there". Three modes narrowed it on no corpus
  // evidence at all, and one of them, `pug`, additionally overturned a recorded `"none"` decision.
  // The owner's original approval was for FOUR syntaxes; eight shipped; the ruling settles it at
  // five. A mode may be added back when a corpus file carrying its form exists.
  //
  // WHAT IS DELIBERATELY NOT ADDED, each with the reason, because a table that claims a format is
  // handled is worse than one that admits it has not looked:
  //
  //   - `.heex` KEEPS `markup`. Its EEx forms `<%# … %>` and `<%!-- … --%>` occur in ONE fixture file
  //     each and in 0 of the 120 corpus `.heex` files — the census this table's own `heex` entry
  //     records — and a check asserts on the residue in both tables. Changing it
  //     is a decision about a format whose evidence is thin on both sides, and it is not this one.
  //   - `.tpl` KEEPS `markup`. Smarty's `{* … *}` has 0 well-formed occurrences in fixtures and in
  //     the corpus, and `.tpl` is not one language (see its entry below). A check
  //     asserts that `{* *}` is NOT stripped from a `.tpl`; that assertion still holds.
  //   - `.handlebars` STAYS UNCLASSIFIED. 16 corpus files, 0 fixtures. Adding an extension to this
  //     table is a different change from correcting the mode of one already in it, and the superset
  //     promise a check enforces would have to move with it.
  //   - Go templates' `{{/* … */}}`. It occurs (5 fixture `.html` files / 7x, 12 corpus `.tpl` files
  //     / 127x) but its extensions are `.html` and `.tpl`, neither of which is a Go template, so
  //     teaching either mode the form would change how 4,585 corpus `.html` files are read on the
  //     strength of a form that occurs in none of them.
  //   - Blade's `<!-- … -->`. `blade` composes `stripPhp`, not `stripMarkup`, so an HTML comment in a
  //     `.blade.php` file is still read as code — as it was before this change, in all 395 corpus
  //     `.blade.php` files that carry one. Widening Blade to markup as well is a second change with
  //     its own price and it is not made here.
  //   - The lines BENEATH a HAML `-#`. HAML silences the more-indented block under a comment
  //     marker; only the marker's own line is blanked here. A check made the same
  //     call for the same reason: leaving those lines in is the under-stripping direction, which
  //     this file's header accepts.
  //   - `.liquid`, `.slim` and `.pug` MODES, removed 2026-08-19 by the ruling above. The
  //     three extensions return to what they were before that day: `.liquid` and `.slim` to
  //     `markup`, `.pug` to `none`. Their fixtures still exist and their comment forms are still
  //     real syntax; what is missing is any corpus file that carries one.
  twig: "twig", jinja: "twig", j2: "twig", njk: "twig",
  hbs: "handlebars", mustache: "handlebars",
  erb: "erb-template", ejs: "erb-template",
  // `liquid: "liquid"` and `slim: "slim"` from 2026-08-19 until the ruling the same day. `markup` is
  // what both were before, and it is right about the one comment form Liquid and Slim templates
  // share with the HTML they emit.
  liquid: "markup", slim: "markup",
  haml: "haml",
  // `blade` was already in this table on 2026-08-12 and was UNREACHABLE until 2026-08-19: nothing
  // resolved a `.blade.php` path to the name `blade`, because this lookup keys on the LAST extension
  // segment and that segment is `php`. See BY_COMPOUND_EXT below, which is what makes the row live.
  blade: "blade",
  // `.tpl`, added 2026-08-12 while widening eu-consent-021's reach to server-rendered templates.
  // It was still the one template extension `syntaxFor` returned null for, so every `.tpl` file in
  // the corpus had its corroboration read over RAW text — an HTML comment in one was code to a
  // gate. `markup` and not a template-specific mode: `.tpl` is not one language (one tree's 129
  // files are PHP-in-HTML, another's 13 are Mustache-in-HTML, Smarty writes `{* … *}`), and
  // `<!-- … -->` is the one comment form all of them share. Under-stripping the dialect-specific
  // forms is this file's stated conservative direction; leaving `<!-- -->` in was not.
  tpl: "markup",
  // Phoenix HEEx templates, added 2026-08-12. HEEx is HTML-aware by construction — its compiler
  // parses the template as HTML rather than as text — so `<!-- … -->` is the comment form these
  // files write, and `markup` additionally reaches the `<script>` bodies they carry.
  //
  // WHAT IS STRIPPED: `<!-- … -->`, plus C-like comments inside `<script>` and `<style>`.
  // WHAT IS NOT STRIPPED: EEx's own `<%# … %>` and HEEx's `<%!-- … --%>`.
  //
  // HOW STRONG THE EVIDENCE IS: THIN, and that is stated rather than left to be discovered. All 120
  // `.heex` files in the 94-tree corpus live in ONE repository (an Elixir analytics application) and 117 are named
  // `*.html.heex`. Every one was searched on 2026-08-12: two carry an HTML comment, two carry `//`
  // inside a `<script>` block, and NOT ONE carries `<%# %>` or `<%!-- --%>`. So this entry rests on
  // what HEEx is; the corpus only fails to contradict it, and cannot confirm the residue is small.
  // Measured both ways over all 117 scanned files: 2 change guard content, 0 gate results flip, 0
  // locations move, and no cut falls inside an `<% … %>` or `{ … }` interpolation.
  heex: "markup",
  // XML dialects, and `markup` is exactly right for them: `<!-- -->` is their only comment form.
  wsdl: "markup", xsd: "markup",
  // `pug: "none"`, and `"none"` in this file MEANS "this format has no comment syntax at all".
  //
  // That entry was changed to a `pug` mode on 2026-08-19 and RESTORED the same day by the owner
  // ruling above. The argument for changing it was that Pug really does have `//-` and `//` and
  // that 6 fixture files carry 61 of them — both true. What it did not have was a single `.pug`
  // file anywhere in the 94 pinned trees, so the change narrowed the scanner on fixture evidence
  // alone while overturning a decision that was recorded rather than assumed. When a corpus file
  // carrying the form exists, the entry can be revisited on that evidence.
  pug: "none",
  json: "none", txt: "none",
};

/**
 * Extensions whose meaning lives in TWO segments, checked BEFORE the single-extension table.
 *
 * `x.blade.php` is a Laravel template — `{{-- --}}` comments and HTML — and reading it as PHP strips
 * `//` it does not have and keeps the comments it does. This lookup keys on the last segment, so
 * `syntaxFor("x.blade.php")` returned `php` from the day the table existed, while
 * `structural/languages.ts` has carried an explicit `/\.blade\.php$/i` case all along. The two
 * disagreed, in silence, for every `.blade.php` file this repository has ever read — recorded as a
 * finding on 2026-08-18 and fixed here. The
 * finding counted 67 corpus files containing `{{--`; counting only comments that also carry their
 * own `--}}` gives 65 files and 149 comments, and 45 of the 46 `.blade.php` fixtures.
 *
 * THE CLASS BEHIND IT IS NOT CLOSED BY THIS TABLE AND THAT IS SAID RATHER THAN LEFT TO BE FOUND.
 * The class is *a compound extension resolved by its last segment, in more than one function, with
 * no shared decision*, and the finding names two candidate fixes: one shared extension resolver used
 * by `languageFor`, `syntaxFor` and anything else keyed on a path, or teaching `syntaxFor` the
 * compound extensions only. This is the second, and it is the smaller one. It is chosen here because
 * the first changes `structural/languages.ts`, whose own header states that `languageFor` is a pure
 * function of one path, and because the decision this change executes covers the comment view
 * rather than the resolver. A check keeps its own `STRIP_MODE_BY_COMPOUND_EXT`
 * with the same single key and the same position in the lookup order, so the two agree today; the
 * shared-resolver question stays open and stays the owner's.
 *
 * A MUTANT'S NAME REACHES THIS THROUGH `fixture-names.ts`, NOT THROUGH A SECOND PATTERN HERE.
 * `x.blade.mut-1.php` does not end in `.blade.php` and must not: this table is scanner behaviour and
 * no user repository contains a `.mut-<n>.` file. `presentFixtureName` already compares `syntaxFor`
 * between a mutant and its base and already rewrites `x.blade.mut-1.php` to `x.mut-1.blade.php` when
 * they disagree — it had to, because `languageFor` disagreed before this change did.
 */
const BY_COMPOUND_EXT: [string, Syntax][] = [["blade.php", "blade"]];

/**
 * Formats whose files carry NO extension, which the table above cannot key on at all — the same
 * hole `.env` fell through, in a different shape. Matched on the whole basename, lowercased.
 *
 * `Dockerfile` is `line-hash` for the reason its extension form is. `Makefile` is `hash`: make
 * treats `#` as starting a comment wherever it appears outside a recipe, and inside a recipe the
 * line is handed to a shell, where `#` is also a comment.
 */
const BY_BASENAME: Record<string, Syntax> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
};

/**
 * dotenv, which the table above cannot reach: its files carry no extension of their own. `.env`
 * has nothing after the dot the extension lookup keys on, and `.env.example`, `.env.local` and
 * `shared.env.example` — the spellings actually shipped in repositories — all end in a segment
 * that says nothing about the syntax.
 *
 * The consequence was not theoretical. Until 2026-08-12 an unclassified `.env` file had its
 * corroboration gate evaluated over raw text, so a COMMENTED-OUT switch opened the gate, in dotenv
 * and in no other format `eu-retention-002` reaches — the exact asymmetry the header of this file
 * records for guards, running the other way. Found by independent verification of that rule, not
 * by its author; the same class as the `.env` entry that a check had gained the
 * same day, where an unregistered extension made the check silently not run.
 *
 * dotenv comments are `#` at any point on a line outside quotes, which is what `hash` strips.
 *
 * THE FIRST VERSION OF THIS TEST WAS `/[/.]env(?:\.[A-Za-z0-9_-]+)?$/` AND IT WAS TOO WIDE, in both
 * directions, and it shipped. The `/` alternative matched any file whose basename is `env` plus one
 * extension, anywhere in a tree. Over the 94 pinned corpus trees it matched 540 files, of which 147
 * are not dotenv at all — 102 `env.ts`, 8 `env.js`, 6 `env.mjs`, 4 `env.py`, and one each of
 * `env.go`, `env.h`, `env.cc`, `Env.vue`, `Env.md`, `env.svg`, `env.proto` among them — and 76 of
 * those 147 had their guard content actually change. That re-opened the very hole this test was
 * added to close, for TypeScript and eight other languages: a `.ts` file read as `hash` keeps its
 * `//` comments, so a commented-out switch opens a corroboration gate. It ran the other way too,
 * which is the direction the header of this file calls the more dangerous one — `env.json` had been
 * returned raw and became hash-stripped, and one tree's `.env.hbs` template, whose
 * body is `{{#if needsDatabase}}`, lost every line from its `#` onward, hiding real content
 * from a guard. Found by independent verification OF THE FIX, not by the agent that wrote it.
 *
 * So the test is anchored on a dot, AND it is a fallback rather than an override: where the
 * extension table can key on a name, the table decides. Both halves are load-bearing and neither
 * alone is enough. Without the dot anchor, `src/env.ts` is read as dotenv. Without the fallback
 * ordering, `.scripts/electron.env.ts`, `docs/2.env.md` and `templates/.env.hbs` are, because a
 * dot-anchored test matches those three as surely as the wide one did.
 *
 * WHAT THE FIXTURE ASSERTS AND WHAT IT DOES NOT. The project fixture
 * `eu-retention-002/fixtures/project-dotenv-name-test/` was watched failing on the ordering
 * (`scripts/electron.env.ts`), on the allow-list below (`podman/env.sample`), and on both together
 * (`src/env.ts`), before this text was written. **It does not assert the dot anchor**, and that is
 * stated rather than left to be discovered: with the ordering fixed, widening `\.` back to `[/.]`
 * leaves every fixture green. The anchor still earns its place — it is what makes the test say
 * "this name is dotenv" rather than "this name starts with env", and the extension table is not
 * exhaustive, so without it any future unlisted extension spelled `env.<ext>` is hash-stripped in
 * silence — but in the 94-tree corpus its only effect on guard content today is on three PNG images
 * (named `env.png`). The five text files it also reclassifies — two `.bru`,
 * one `.proto`, one `.svg`, one `.phtml` — contain no `#` outside quotes, so their content comes
 * out the same either way.
 */
const DOTENV = /\.env(?:\.[A-Za-z0-9_-]+)?$/;

/**
 * The dotenv templates the dot anchor cannot reach, because their name puts nothing before `env`.
 *
 * Two are in the corpus and both were read before this list was written, rather than counted from
 * their names: one `env.sample`, whose own first line asks the reader to rename it to `.env` and
 * fill in the values; and one `env.example`, in which all 80 lines are blank, a `#`
 * comment, or a setting commented out with `#` — the file in this corpus that most needs stripping
 * and the one a dot anchor alone would miss. `template`, `dist` and `defaults` are the same naming
 * convention in different words, are listed for reach rather than because the corpus has them, and
 * are safe to list because no language uses any of the five as a source extension. Everything else
 * named `env.<something>` keeps whatever the extension table says, which for `env.ts` is C-like and
 * for `env.json` is "returned unchanged".
 */
const DOTENV_TEMPLATE = /(?:^|\/)env\.(?:example|sample|template|dist|defaults)$/;

/**
 * Suffixes that are NOT a format, and cannot be a row in `BY_EXT` without the table lying.
 *
 * `.eex` is Embedded Elixir, which is a generic templating layer: `X.eex` renders to X, and the
 * comment syntax the file actually writes is X's. The corpus says exactly that and it was counted
 * before this was written — of the 50 `.eex` files in the 94 pinned trees, **45 are `*.sql.eex`**,
 * one is `env.sh.eex`, one `vm.args.eex`, one `*.mjml.eex`, one `*.bat.eex` and one `*.html.eex`.
 *
 * SO THE OBVIOUS ENTRY IS THE WRONG ONE. `eex: "markup"` was built and measured on 2026-08-12
 * alongside this: it changes the guard content of **0 of the 50 files**, because none of them is
 * HTML. It would stop `.eex` reporting as unclassified while stripping nothing — and the 45 SQL
 * files would keep having their `--` comments read as code by a corroboration gate, which is
 * defect (3) in the header of this file, the one `ok-migration-one-off-data-fix.sql` exists for.
 * A table that claims a format is handled is worse than one that admits it has not looked.
 *
 * What is done instead is to resolve the name without the suffix and ask again: `x.sql.eex` is
 * `sql`, `env.sh.eex` is `hash`, `x.html.eex` is `markup`, `.env.eex` is dotenv, `Makefile.eex` is
 * `hash`. Where the inner name is one this file has not classified either — `vm.args.eex`,
 * `x.mjml.eex`, `x.bat.eex`, and a bare `x.eex` — the answer stays `null`, which is exactly today's
 * behaviour and this file's conservative direction.
 *
 * WHAT IS NOT STRIPPED: EEx's own comment forms, `<%# … %>` and `<%!-- … --%>`. Both were searched
 * for across all 50 files and neither occurs once; the inner format's syntax is what these files
 * actually comment in.
 *
 * MEASURED, not assumed. Both ways over all 50 scanned files: 2 change guard content — a `-- Ch…`
 * trailing comment in one tree's SQL migration, and 16 lines of `#`-commented shell
 * in the same tree's `env.sh.eex`, eight of which are commented-out `export` settings — 0 gate
 * results flip and 0 locations move. Every changed character was checked against the file's
 * `<% … %>` spans: the one that lands inside a tag is inside a `#` comment that contains the tag.
 *
 * Checked before `BY_BASENAME` and after `BY_EXT`, so an explicit table row would still win, and
 * so `Dockerfile.eex` reaches the basename table. Recursion terminates because the name shortens.
 */
const GENERIC_TEMPLATE_SUFFIX = new Set(["eex"]);

/** Replace a span with spaces, keeping newlines so line numbers do not shift. */
function blank(text: string, from: number, to: number): string {
  let out = "";
  for (let i = from; i < to; i++) out += text[i] === "\n" ? "\n" : " ";
  return out;
}

/**
 * THE REGULAR-EXPRESSION-LITERAL PROBLEM, AND THE RULE THIS FILE DECIDES IT BY.
 *
 * Until 2026-08-13 `stripCLike` had no regular-expression state at all. A line containing a regex
 * literal with a quote character in it desynchronised its quote tracking, and everything after that
 * point in the file was read with the wrong string/comment state. An example of the shape is
 * `name.replace(/['"]+/g, "")` early in a file: from there on the
 * stripper believed it was inside a single-quoted string, and many lines later the `"` opening
 * `"//ads.example.com/tag/js/ad.js"` was read as a CLOSING quote, so the `//` inside
 * that string was taken for a line comment and the rest of the line was blanked. That deleted the
 * one piece of corroboration `eu-consent-014` needed and **shut its gate on the file**. A gate that
 * wrongly shuts produces nothing, so the loss is silent and cannot be counted from the output.
 *
 * `/` is genuinely ambiguous in JavaScript — division after a value, a regex start after an
 * operator or a keyword — and no lexer decides it correctly without a parser. So a rule has to be
 * chosen, and the rule is:
 *
 *   A `/` opens a regular-expression literal only when (1) the previous significant character in
 *   the same code context is one of `( , = : ; [ { ! & | ?`, or the `>` of an `=>`, or the end of
 *   one of the keywords in REGEX_AFTER_KEYWORDS not reached through a `.`, or nothing at all; AND
 *   (2) the literal closes with an unescaped `/` outside a `[…]` class BEFORE the end of that line,
 *   with the closing `/` not itself followed by `/` or `*`.
 *
 * WHAT IT GETS WRONG, IN EACH DIRECTION.
 *
 *   Missed regexes (read as division — today's behaviour, so no new failure): every position not on
 *   the list. `)` and `}` are deliberately excluded even though `if (x) /re/.test(s)` and a regex
 *   opening a statement after a block are both legal, because those two are the positions no lexer
 *   can resolve — `(a + b) / c` and `{…} / 2` are division after the identical character — and
 *   guessing wrong there would ADD a failure where today there is one already known. Also missed:
 *   any literal written across a line break (impossible in the grammar) and, by clause (2), any
 *   literal immediately followed by `/` or `*`.
 *
 *   False regexes (division read as a literal): a `/` in one of those positions whose line happens
 *   to hold a later `/`. The span between them is emitted VERBATIM — never blanked — so a false
 *   positive can only cause the stripper to skip over state-changing characters for the rest of one
 *   line. It can never hide code. Measured against the repository's own tree-sitter TypeScript and
 *   TSX grammars over every `.ts`/`.tsx` file whose output this change moves: 7,392 literals agreed,
 *   **0 real literals missed**, and **7 false ones, every one of them the `/usr/` of a `#!` shebang
 *   line**, which is emitted unchanged either way and moves nothing.
 *
 * THE LANGUAGES IN `c-like` THAT HAVE NO REGULAR-EXPRESSION LITERAL — Go, Java, C#, Rust, C, C++,
 * Objective-C, Kotlin, Scala, Dart, Prisma, PHP. The mode is NOT split for them, and that is a
 * measured decision rather than a convenience. In those languages an expression may not begin with
 * `/`, so after `( , = : ; [ { ! & | ?` a `/` is a comment opener (checked first, before this rule)
 * or a syntax error; the rule therefore has almost nothing to fire on. Measured over all 342,257
 * `c-like` files in the 94 pinned corpus trees, the change alters the guard content of **3**
 * non-JavaScript files, all PHP, and every one of the three is a correction: two `//` comments in
 * one PHP form library and six `/** … *​/` lines in a Blade file that the old
 * stripper left standing, and one line in another Blade file — `if (/^ftp:\/\//.test(url))` —
 * that the old stripper BLANKED as if the `//` inside the literal started a comment. Zero files
 * changed in `.go`, `.java`, `.cs`, `.rs`, `.c`, `.h`, `.cc`, `.cpp`, `.hpp`, `.kt`, `.kts`,
 * `.swift`, `.dart`, `.prisma`, `.m` and `.mm`. Swift 5.7 does have bare regex literals, so for
 * `.swift` the rule is right about the language as well.
 *
 * THE THREE OTHER PATHS THAT COMPOSE `stripCLike`, AND WHY NONE OF THEM GETS A FLAG TO TURN THIS
 * OFF. `stripHcl` is `stripCLike(stripHash(text), true)`, the `css` mode is `stripCLike(text,
 * false)`, and `stripMarkup` hands every `<script>` and `<style>` body to `stripCLike`. HCL and CSS
 * have no regular-expression literal at all, and both are full of the shapes this rule looks at —
 * `url(/img/a.png)` and `grid-area: 1 / 2 / 3 / 4` in CSS, integer division and file paths in
 * Terraform — so the obvious guess is that the rule misreads them. It does not, and this was
 * measured on 2026-08-13 rather than reasoned:
 * over the 8,009 `css`/`scss`/`sass` files and
 * the 94 `tf`/`tfvars`/`hcl` files the walker returns across the 94 pinned corpus trees, removing
 * this branch changes the guard content of **0 files in each**. Clause (2) is most of why — the
 * literal must close on the SAME LINE with a `/` that is not followed by `/` or `*`, and a Terraform
 * path that carries a second `/` is inside quotes, where the reader is in a string frame and this
 * branch is never reached.
 *
 * THE NULL RESULT IS BOUNDED BY THIS CORPUS AND BY WELL-FORMEDNESS, and an earlier version of this
 * paragraph claimed more than that. It said a recognised span is emitted verbatim so "the only thing
 * that can go wrong is that the reader skips state-changing characters inside it, and there are
 * none". There can be: a QUOTE inside the recognised span is skipped, which keeps the reader in code
 * state where it would otherwise have entered a string, and code state blanks comments.
 * `p { background: url(/a"b/c /* x *​/ d"); }` and `b = f(/a"b/c // x` both move. **Neither is
 * well-formed for its format**, which is why 0 of the 8,103 corpus files show it — but a scanner
 * reads whatever a user's tree contains, including generated, templated and truncated CSS, so this
 * is a property of the input and not of the formats. **A flag would still buy nothing that can be
 * measured, so there is none.** For `markup` a flag would be actively wrong: a `<script>` body is
 * JavaScript, and 409 of the 518 lines this branch newly blanks in markup files are genuine comments
 * (384 of them `//`, 25 block comments) in real Vue and Svelte component scripts.
 */
const REGEX_AFTER_CHARS = new Set(["(", ",", "=", ":", ";", "[", "{", "!", "&", "|", "?"]);
const REGEX_AFTER_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await", "throw",
]);

/**
 * The index just past the closing `/` of the regular-expression literal starting at `start`, or
 * `-1` when the text there is not one.
 *
 * Three things this has to know and a line-scanning stripper does not:
 *   - `\` escapes the next character, so `/\//` is a literal matching a slash and does not end at
 *     its middle `/`;
 *   - inside a `[…]` character class a `/` is an ordinary character, so `/[/]/` ends at the third
 *     `/` and not the second;
 *   - a literal cannot contain a line terminator. That is grammar, not a heuristic, and it is what
 *     bounds a wrong guess to a single line: an unterminated hypothesis is ABANDONED rather than
 *     run on to the next `/` somewhere further down the file.
 *
 * The closing `/` may not be followed by `/` or `*`. Real flags are letters, so this costs nothing
 * real and it stops a division that precedes a comment on the same line — `calc(100% / 3); /* … *​/`
 * is the shape — from swallowing the comment opener and leaving the comment standing.
 */
function regexLiteralEnd(text: string, start: number): number {
  let j = start + 1;
  let inClass = false;
  while (j < text.length) {
    const ch = text[j];
    if (ch === "\n") return -1;
    if (ch === "\\") {
      if (j + 1 >= text.length || text[j + 1] === "\n") return -1;
      j += 2;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      j++;
      continue;
    }
    if (ch === "[") { inClass = true; j++; continue; }
    if (ch === "/") {
      const next = text[j + 1];
      if (next === "/" || next === "*") return -1;
      return j + 1;
    }
    j++;
  }
  return -1;
}

/**
 * One nesting level of the reader. `code` is both the top level and the inside of a `${ … }`
 * substitution — the two behave identically, and `subst` only records which `}` returns to a
 * template. Before 2026-08-13 a backtick was treated as a third kind of quote, which read the
 * inside of every interpolation as string text: a nested template (`` `${ f(`x`) }` ``) closed the
 * outer literal at the inner backtick and desynchronised everything after it, and a comment inside
 * an interpolation was left standing in front of a gate.
 */
type Frame =
  | {
      kind: "code";
      subst: boolean;
      depth: number;
      sig1: string;
      sig2: string;
      /** Start and end offsets in `text` of the identifier ending at `sig1`, or -1 for "not one". */
      wordStart: number;
      wordEnd: number;
      afterDot: boolean;
    }
  | { kind: "string"; q: string }
  | { kind: "template" };

function newCodeFrame(subst: boolean): Frame {
  return { kind: "code", subst, depth: 0, sig1: "", sig2: "", wordStart: -1, wordEnd: -1, afterDot: false };
}

/**
 * Remember the last two significant characters, and where the identifier ending at the last one
 * begins.
 *
 * The identifier is kept as a pair of OFFSETS rather than as an accumulated string, and that is a
 * measured choice rather than a stylistic one: building it character by character costs one string
 * allocation per identifier character over every file the scanner reads, and it made this function
 * 2.9x slower than the reader it replaced. The offsets are valid because this stripper preserves
 * length exactly — every branch emits as many characters as it consumes — so a position in `text`
 * is the same position in the output.
 */
function noteSignificant(f: Frame & { kind: "code" }, ch: string, index: number): void {
  if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v") return;
  const prev = f.sig1;
  f.sig2 = prev;
  f.sig1 = ch;
  if (isWordChar(ch)) {
    if (f.wordStart < 0) {
      f.wordStart = index;
      f.afterDot = prev === ".";
    }
    f.wordEnd = index + 1;
  } else {
    f.wordStart = -1;
    f.afterDot = false;
  }
}

/** `[A-Za-z0-9_$]`, by character code: this runs once per significant character of every file. */
function isWordChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (
    (c >= 97 && c <= 122) || // a-z
    (c >= 65 && c <= 90) || // A-Z
    (c >= 48 && c <= 57) || // 0-9
    c === 95 || // _
    c === 36 // $
  );
}

/** Whether a `/` at this point may open a regular-expression literal. See the note above. */
function regexMayStart(text: string, f: Frame & { kind: "code" }): boolean {
  if (f.sig1 === "") return true;
  if (isWordChar(f.sig1)) {
    if (f.afterDot || f.wordStart < 0) return false;
    // Every keyword in the set is at most ten characters, so a longer identifier is not one of them
    // and the slice is skipped. This also keeps `myreturn` from being read as `return`.
    if (f.wordEnd - f.wordStart > 10) return false;
    return REGEX_AFTER_KEYWORDS.has(text.slice(f.wordStart, f.wordEnd));
  }
  // `>` only as the tail of an arrow (`() => /re/.test(x)`), never JSX's own `>`.
  if (f.sig1 === ">") return f.sig2 === "=";
  return REGEX_AFTER_CHARS.has(f.sig1);
}

/**
 * THE APOSTROPHE PROBLEM, AND THE RULE THIS FILE DECIDES IT BY.
 *
 * Until 2026-08-13 a `'` always opened a string frame here, and the frame ran to the next `'`
 * ANYWHERE later in the file. In two of the languages `c-like` serves, a `'` is frequently not a
 * string delimiter at all, and every such occurrence inverted the reader's quote parity for the
 * remainder of the construct — after which the INSIDE of every real string was read as code (so a
 * `//` in a URL blanked the rest of its line) and the outside was read as string (so real comments
 * reached a gate). That is the same class as the regular-expression-literal defect above and the
 * same two directions.
 *
 *   JSX/TSX TEXT. `<p>It's here</p>` — the apostrophe is prose. **743 of the corpus's 58,222 `.tsx`
 *   files carry an apostrophe inside element text**, and 572 of them ended inside an unterminated
 *   string, which is 1 in 102 of every `.tsx` file the walker returns.
 *
 *   RUST LIFETIMES AND LABELS. `&'a str`, `Foo<'a, 'b>`, `'static`, `for<'de>`, `'outer: loop`.
 *   **345 of the corpus's 925 `.rs` files carry a lifetime-shaped token** — the test is
 *   `(?:^|[^A-Za-z0-9_'"])'[A-Za-z_][A-Za-z0-9_]*(?!['A-Za-z0-9_])`, and **271 carry a construct
 *   that can only be a lifetime** (`&'x`, `<'x`, `'static`, `for<'`). The first version of this note
 *   said 527, which came from the same pattern with NO LEFT BOUNDARY and therefore counted the
 *   opening quote of every ordinary `'word…'` string; corrected 2026-08-13 after independent
 *   verification, and the correction is one order smaller than the one it was itself correcting.
 *   **100 `.rs` files ended inside an unterminated string — 10.8 % of every `.rs` file in the
 *   corpus** — and every one of those 100 carries a lifetime.
 *
 * THE RULE: **a `'` opens a string only when an unescaped `'` closes it before the end of its
 * line.** A `\` escapes the next character, and a `\` immediately before a newline is a LINE
 * CONTINUATION that carries the literal on — that is grammar, not a courtesy, and leaving it out
 * cost 611 lines of genuine comment in one tree's `h5p.js`, whose jQuery template is one `'…'` string
 * spelled across seven continued lines. When the rule refuses, the `'` is emitted as an ordinary
 * code character; nothing is ever blanked by this branch.
 *
 * WHY IT IS LANGUAGE-AGNOSTIC RATHER THAN A PER-LANGUAGE MODE, priced rather than argued. A
 * per-language variant was built (`.rs` gets Rust's own char-literal rule, `.jsx`/`.tsx` get this
 * one) and measured on 2026-08-13: it changes **270 files against this rule's 286**, and the
 * difference is the population it cannot reach. **JSX is not confined to `.jsx` and `.tsx`** — it is
 * written in `.js`, `.mjs` and `.gjs` too. A dialect table would have to name every extension JSX
 * might appear in, which is not a closed set, and `c-like` would then have two behaviours to test
 * instead of one.
 *
 * THAT COMPARISON MIXED TWO CONDITIONS AND IS CORRECTED HERE (2026-08-13, independent verification,
 * defects D5 and D6). `B` was built WITHOUT the unterminated-`/*` condition below, so 270 against 286
 * is not like for like. Measured both ways: **`B` 270 against this rule without that condition
 * 283, and `B`+that condition 273 against 286 — 13 net either way. 14 files the dialect table
 * cannot reach, and 1 file it reaches that this rule does not**
 * (one Rust test file, where Rust's own char-literal rule
 * changes the answer and the same-line rule does not). The 14 are 8 `.js` and one each of `.h`,
 * `.cpp`, `.cc`, `.mm`, `.dart` and `.gjs`; **5 of the 8 `.js` files carry JSX** (`{/* … *​/}`
 * comments in two real trees) and 3 are plain JavaScript whose desynchronising apostrophe
 * is elsewhere in the file. 14 against 1 is still decisive and the not-a-closed-set argument does not
 * rest on the arithmetic.
 *
 * WHAT IT COSTS THE LANGUAGES WHERE `'` REALLY IS A DELIMITER — C, C++, Objective-C, Java, C#, Go,
 * Kotlin, Scala, Swift, Dart. A character literal closes on its own line by the grammar of every one
 * of them, so the rule never refuses one: `'a'`, `'\''`, `'\n'`, `b'x'` and `'\u{1F600}'` all still
 * delimit. Measured over all 283,893 `c-like` files the walker returns across the 94 pinned corpus
 * trees, this rule changes **5 files** outside the JavaScript and Rust families — one `.h`, one
 * `.cpp`, one `.cc`, one `.mm`, one `.dart` — 39 lines, **every one of them a genuine comment**, and
 * every one a CORRECTION of a comment the old reader left standing. Four of the five are one firmware project
 * firmware, where the trigger is C++14's DIGIT SEPARATOR: `250'000` and `1'000'000UL` are two more
 * apostrophes that are not delimiters, and this rule handles them for the same reason it handles a
 * lifetime.
 *
 * THE VARIANT THAT APPLIES THE SAME RULE TO `"` WAS BUILT AND REJECTED ON ITS PRICE. It fixes one
 * more shape — an unbalanced `"` inside JSX element text — and costs **22 `c-family` files and 723
 * lines against this rule's 5 and 39**, because `"` legitimately opens a MULTI-LINE literal in C#
 * (`@"…"`), Java (`"""`), Swift, Kotlin, Scala and C++ (`R"(…)"`), and Rust's ordinary `"…"` spans
 * lines as well. Refusing those opens their bodies to the comment blanker, which is this file's
 * dangerous direction.
 *
 * `'…'` HAS NO MULTI-LINE FORM IN ANY LANGUAGE THIS FUNCTION IS CALLED FOR **EXCEPT PHP**, AND THE
 * FIRST VERSION OF THIS NOTE SAID "in any language in this mode" WITH NO EXCEPTION. That sentence
 * was false and it was the whole argument for treating `'` and `"` differently. **A PHP
 * single-quoted string legally spans lines**, `stripPhp` composes this function, and the `.php`
 * population — 58,364 files — was not measured at all when the rule shipped. Found by independent
 * verification, measured on
 * 2026-08-13 over every one of those files, and it moved in BOTH directions: **52 files changed,
 * 728 lines of genuine PHP comment newly reached the corroboration gates, and 3 lines of real
 * content were newly hidden from them** — an XPath expression in one tree's
 * PHP files, a `preg_match("/^#|\/\//", $s)` in another, and a
 * `<!DOCTYPE … "-//W3C//DTD …">` string in a third. So the exception is
 * not a theoretical one and it is not one-directional.
 *
 * THE ANSWER IS `singleQuoteSpansLines`, AND `stripPhp` IS ITS ONLY CALLER. That is not the dialect
 * table §4.1 of the record rejects: `syntaxFor` already resolves `php` to its own mode, `stripPhp`
 * already exists as a per-language composed wrapper beside `stripHcl`, and the flag is passed by
 * that wrapper and by nothing else — so there is no second copy of any extension table and no
 * open-ended set of extensions to enumerate. **Measured: the flag changes 0 of the 283,893 `c-like`
 * files and reduces `.php` to 1 changed file**.
 * What it gives up is 223 `//` comment lines that
 * the same-line rule was correctly blanking in PHP and 78 lines of content it was recovering inside
 * heredocs; that is the price of not re-introducing 728 comment lines in front of the gates.
 *
 * WHAT THE RULE ITSELF GETS WRONG, named and sized rather than left to be found. **A JSX ATTRIBUTE
 * VALUE IS NOT A JAVASCRIPT STRING**: `url='…'` in JSX may legally contain newlines, and this rule
 * refuses such a quote. Measured against the repository's own tree-sitter TSX grammar over every
 * `.tsx`/`.jsx`/`.js` file this change moves, that is the WHOLE of the new over-stripping it
 * introduces: **12 characters over 3 lines in 2 files**, all of them a base64 `data:` URI that a
 * formatter wrapped across ten lines inside `url='…'` (one tree's Storybook stories). Against the
 * same oracle the change removes far more than it adds — over the 105 cleanly-parsed files it moves,
 * characters blanked outside any real comment fall from **11,994 to 32** and real comment characters
 * left unblanked fall from **20,302 to 176**. The 20 residual characters that are not the JSX
 * attribute case are a regular-expression literal opening a line (`/\//.source +`) in two real
 * files, which this change neither causes nor cures.
 */
function singleQuoteCloses(text: string, start: number): boolean {
  let j = start + 1;
  while (j < text.length) {
    const ch = text[j];
    if (ch === "\n") return false;
    // `\` escapes the next character. A `\` immediately before a newline is a line continuation and
    // the literal carries on, so the scan deliberately steps over the newline here.
    if (ch === "\\") { j += 2; continue; }
    if (ch === "'") return true;
    j++;
  }
  return false;
}

function stripCLike(text: string, lineComments: boolean, singleQuoteSpansLines = false): string {
  let out = "";
  let i = 0;
  const stack: Frame[] = [newCodeFrame(false)];
  while (i < text.length) {
    const f = stack[stack.length - 1];
    const ch = text[i];
    if (f.kind === "string") {
      out += ch;
      if (ch === "\\") { out += text[i + 1] ?? ""; i += 2; continue; }
      if (ch === f.q) stack.pop();
      i++;
      continue;
    }
    if (f.kind === "template") {
      if (ch === "\\") { out += ch + (text[i + 1] ?? ""); i += 2; continue; }
      if (ch === "`") { out += ch; stack.pop(); i++; continue; }
      if (ch === "$" && text[i + 1] === "{") { out += "${"; stack.push(newCodeFrame(true)); i += 2; continue; }
      out += ch;
      i++;
      continue;
    }
    // Comments are tested before a regex literal and that order is the grammar's, not a preference:
    // `//` is a line comment and never an empty literal, and `/*` is a block comment and never a
    // literal whose first character is `*`.
    // `text[i - 1] !== ":"` keeps an unquoted https:// out of the line-comment branch.
    if (lineComments && ch === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
      let j = i;
      while (j < text.length && text[j] !== "\n") j++;
      out += blank(text, i, j);
      i = j;
      continue;
    }
    if (ch === "#" && !lineComments) { /* not a comment in CSS */ }
    // AN UNTERMINATED `/*` IS NOT A BLOCK COMMENT, changed 2026-08-13 (work item #46).
    //
    // It used to blank to end of file, and that is the shape this workspace has now met three times:
    // `stripMarkup`'s `<!--` with no `-->`, its runaway `<script … />` span, and this. The reason it
    // is not theoretical here is that `stripCLike` READS JSX TEXT AS CODE, and JSX text is full of
    // globs — `<code>/products/*</code>`, `user/* matches user/admin`, `https://*.domain.com`,
    // `/** matches all paths, /services/* matches` — each of which opens a block comment that never
    // closes.
    //
    // MEASURED ON ITS OWN, over all 283,893 `c-like` files the walker returns across the 94 pinned
    // corpus trees: **5 files change, 0 lines are newly blanked, and 940 lines / 23,590 characters
    // stop being blanked**. Not one of the 940 is a comment. The largest is 403 lines of Rust in
    // one Rust source file, where a `format!("refs/{}/*", name)` call
    // blanked everything from one line to the end of the file, and 347 lines of JSX prose in
    // one React component. **A pass that only stops blanking cannot hide code**, so
    // this branch has one direction and it is the recovering one.
    //
    // WHAT IS GIVEN UP: a genuinely truncated file whose last comment is left open now has that
    // comment's text reaching a gate instead of being blanked. That is the under-stripping direction
    // this file's header accepts, and it is what the old behaviour bought at the price above.
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) {
        out += ch;
        noteSignificant(f, ch, i);
        i++;
        continue;
      }
      const j = end + 2;
      out += blank(text, i, j);
      i = j;
      continue;
    }
    // A regular-expression literal. Emitted VERBATIM, never blanked: it is code, a rule may
    // legitimately want to match inside one, and emitting it whole is the entire point — the
    // characters between the two `/` no longer touch the quote and comment state.
    // `text[i + 1] !== "/"` is not covered by the branch above, which does not run in CSS mode and
    // is skipped after a `:` so that `https://` survives.
    if (ch === "/" && text[i + 1] !== "/" && regexMayStart(text, f)) {
      const end = regexLiteralEnd(text, i);
      if (end !== -1) {
        out += text.slice(i, end);
        i = end;
        noteSignificant(f, "/", end - 1);
        continue;
      }
    }
    if (ch === '"' || ch === "'") {
      // A `'` that does not close on its own line is not a delimiter: a JSX text apostrophe, a Rust
      // lifetime or label, or a C++14 digit separator. See the note above `singleQuoteCloses`.
      // `singleQuoteSpansLines` switches the test off for PHP, whose `'…'` really does span lines.
      if (ch === "'" && !singleQuoteSpansLines && !singleQuoteCloses(text, i)) {
        out += ch;
        noteSignificant(f, ch, i);
        i++;
        continue;
      }
      out += ch;
      noteSignificant(f, ch, i);
      stack.push({ kind: "string", q: ch });
      i++;
      continue;
    }
    if (ch === "`") {
      out += ch;
      noteSignificant(f, ch, i);
      stack.push({ kind: "template" });
      i++;
      continue;
    }
    if (ch === "{") f.depth++;
    else if (ch === "}") {
      if (f.subst && f.depth === 0) { out += ch; stack.pop(); i++; continue; }
      if (f.depth > 0) f.depth--;
    }
    out += ch;
    noteSignificant(f, ch, i);
    i++;
  }
  return out;
}

/**
 * `#` to end of line, outside quotes, per line. Serves `.py .pyi .rb .rake .sh .bash .yaml .yml
 * .toml .ini .properties .ex .exs`, `Makefile` and dotenv.
 *
 * FOUR CONSTRUCTS IN WHICH A `#` IS NOT A COMMENT, added 2026-08-19. The defect predates that day
 * by months; what was new is that the match-side change made this view decide candidates as well as
 * guards, so a reader defect that used to cost nothing started costing them.
 *
 * THE RECORD THIS FIXES NAMED TWO OF THE FOUR AND PUT THE EXPOSURE AT EIGHT LINES. Independent verification found a third and put the
 * exposure three orders of magnitude higher; the census below was then re-derived here, over every
 * line of every `hash`-mode file in `rules/**` and all 94 pinned trees — 40,905 files, 6,574,796
 * lines, of which the pre-fix reader cuts 271,321.
 *
 *   1. `#{ … }` STRING INTERPOLATION (Ruby, Elixir) — **4,110 lines**. Not a comment anywhere, and
 *      the case that matters is where it appears OUTSIDE a quote as this scanner sees the line: a
 *      heredoc body (`AND NOT #{table_name}.user_deleted`), a line continuing a string opened
 *      earlier, or an HTML attribute between two quoted ones —
 *      `<img src='#{og.secure_image_url}' #{og.title_attr} width='#{og.image_width}'>`, where the
 *      first interpolation is inside the `'…'` pair and the second is not. The body is skipped to
 *      its MATCHING `}` with nesting and nested quotes tracked, so `#{"http://#{host}:#{port}"}`
 *      (Elixir, plausible) reads as one unit.
 *   2. `%w[ … ]` WORD-ARRAY LITERALS (Ruby) and their `%W %i %I` siblings, over the four bracket
 *      pairs — **64 lines**. `actions: %w[groups#members groups#add_members]` is a list of Rails
 *      route names.
 *   3. ELIXIR SIGILS `~w( … )` `~s/ … /` `~r{ … }` — **175 lines**. `~s(#/filters/0: Invalid …)`
 *      and `~s/button#add-shared-link-button/` are strings, and `~w(: ? # [ ] @ …)` is a word list
 *      whose third element IS `#`.
 *   4. HTML NUMERIC CHARACTER REFERENCES `&#8599;` / `&#x2197;` — **95 lines**. THIS ONE WAS FOUND
 *      BY THE INDEPENDENT VERIFICATION AND BY NEITHER THE RECORD NOR THIS AUTHOR. It cost six real
 *      candidates: `.yml` is `hash`, the reader cut at the `#` of `&#8599;`, and what it deleted was
 *      a real `<img … width height>` with NO `alt` in a Rails forum's bot translations in four
 *      languages — `eu-accessibility-001`'s target exactly. In YAML a comment needs whitespace
 *      before the `#` and the preceding character here is `&`. The other 89 are Ruby regex literals
 *      (`title.gsub!(/&#8220;/, '"')`) and one Elixir component.
 *
 * All four are wrong in EVERY format this mode serves, which is why they are fixed here rather than
 * in a Ruby/Elixir-scoped mode: **4,444 lines in total**, and `.py`, `.pyi`, `.sh`, `.bash`,
 * `.toml`, `.ini`, `.properties`, `Makefile`, dotenv, `.tf`, `.tfvars` and `.hcl` contribute **0**
 * to them.
 *
 * WHAT THE FIX BUYS IN CANDIDATES, measured by a before/after sweep of all 94 trees: **14 locations
 * return and 0 are lost** — `eu-accessibility-001` 10 (4 link-preview `<img>` tags built by
 * interpolation, and 6 `<img … width height>` tags with no `alt` in narrative-bot translations that
 * an `&#NNNN;` entity was deleting), `eu-dsa-002` 2, `baseline-006` 1, `baseline-003` 1. That is the
 * 8 the record named plus the 6 the verification found, with no residue either way. A fifth mode would buy nothing and would add a row that `strip-comments.ts`,
 * `structural/languages.ts` and a check must agree about — the class
 * an internal record already records as open.
 *
 * DIRECTION, which is the safety question this file's header asks. Measured with THIS function
 * imported from the built engine, against the four-line scanner it replaces, over the same
 * 6,574,796 lines: it **keeps 4,416 lines the old reader cut entirely and cuts 28 later than it
 * did; it cuts 0 lines the old reader kept**, in either form. The change is therefore pure
 * UNDER-stripping against today's corpus. It CAN blank in principle — `%w[a"b] # c` has an
 * unbalanced quote inside the literal, so skipping the literal makes the trailing `#` a comment
 * where the old reader thought it was inside a string — and that is the correct answer, with 0
 * instances in the corpus.
 *
 * A FIFTH SHAPE IS MEASURED AND DELIBERATELY NOT FIXED HERE, because it is a LANGUAGE rule rather
 * than a construct and fixing it needs per-language scoping this mode does not have. **In YAML and
 * shell a `#` is a comment only at line start or after whitespace**; in Ruby, Python, TOML, INI and
 * Makefile it is a comment anywhere. The pre-fix reader cuts at a `#` preceded by a non-whitespace
 * character on **3,275 lines, of which 3,020 are `.yaml` `.yml` `.sh` `.bash`** — where the cut is
 * wrong — and 255 in formats where it is right. Trigger 4 above is the slice of that shape which is
 * safe to close for every format at once. **The remaining ~3,020 lines are a sized, unfixed
 * exposure**, and closing them is a scoping decision, not this change.
 *
 * WHAT IS STILL NOT KNOWN, said plainly rather than left for a reader to discover:
 *
 *   - a `#` inside a Ruby regex literal (`/#/`) or a character literal (`?#`);
 *   - `%w` with a NON-BRACKET delimiter, which Ruby allows: `%w|a b|`, `%w!a b!`, `%w/a b/`. Only
 *     the four bracket pairs are handled, because a bracket pair nests and a repeated character
 *     cannot, so the other forms need a different rule rather than another table row;
 *   - `#{ … }` reached while the scanner is INSIDE a quote, where it is skipped as string content
 *     already — but the quote tracking can still desynchronise on an interpolation body carrying an
 *     odd number of quotes, which is unchanged behaviour and is not fixed here;
 *   - a `#{` written as the first characters of a genuine comment in Python, shell, TOML, INI or
 *     dotenv, which is now KEPT rather than blanked. It occurs 0 times in this corpus, an assertion
 *     in a check locks it so that closing it has to be deliberate, and if it ever
 *     stops being inert the fix is a Ruby/Elixir-scoped mode, not a change here.
 *
 * WHERE THE ANSWER LIVES. It is `hashCommentStart` below, exported, and
 * a check — which had its own `hash` scanner from 2026-08-11 — now imports it,
 * the same arrangement it already has for `markupElementAt`, `syntaxFor` and `TEMPLATE_COMMENTS`.
 * The two BLANKERS stay separate on purpose (that one emits newlines only and does not preserve
 * length, because it feeds an identity comparison rather than a line-numbered guard), but what
 * COUNTS as a comment is one fact and is written once. That is the project's rule, "never keep a second copy
 * of anything two places must agree on — export it and import it".
 */
const WORD_ARRAY_DELIMS: Record<string, string> = { "[": "]", "(": ")", "{": "}", "<": ">" };
// Elixir sigil delimiters. The four bracket pairs nest; `/` and `|` do not and close at the first
// repeat, which is why they are written as their own closer rather than looked up in the pairs.
const SIGIL_DELIMS: Record<string, string> = { ...WORD_ARRAY_DELIMS, "/": "/", "|": "|" };
const HTML_ENTITY = /^&#(?:[0-9]{1,7}|[xX][0-9A-Fa-f]{1,6});/;

/**
 * The index of the `#` that begins a comment on this line, or -1 if the line carries none. Quote
 * state is single-line. See the block above `WORD_ARRAY_DELIMS` for what this knows and what it
 * still does not.
 */
export function hashCommentStart(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    // `%w[ … ]` and siblings: skip the literal whole, so a `#` inside it is data.
    if (ch === "%" && /[wWiI]/.test(line[i + 1] ?? "")) {
      const open = line[i + 2] ?? "";
      const close = WORD_ARRAY_DELIMS[open];
      if (close) {
        let depth = 1;
        let j = i + 3;
        for (; j < line.length; j++) {
          if (line[j] === "\\") { j++; continue; }
          if (line[j] === open && open !== close) depth++;
          else if (line[j] === close && --depth === 0) break;
        }
        i = j; // the `for` step moves past the closer, or past end of line if unterminated
        continue;
      }
    }
    // Elixir sigils, `~w( … )` `~s/ … /` `~r{ … }` and the rest: skip to the closing delimiter.
    if (ch === "~" && /[a-zA-Z]/.test(line[i + 1] ?? "")) {
      let k = i + 1;
      while (k < line.length && /[a-zA-Z]/.test(line[k])) k++;
      const open = line[k] ?? "";
      const close = SIGIL_DELIMS[open];
      if (close) {
        let depth = 1;
        let j = k + 1;
        for (; j < line.length; j++) {
          if (line[j] === "\\") { j++; continue; }
          if (line[j] === open && open !== close) depth++;
          else if (line[j] === close && --depth === 0) break;
        }
        i = j;
        continue;
      }
    }
    // An HTML numeric character reference — `&#8599;`, `&#x2197;`. The `#` is the entity's own
    // second character, never a comment start, and the case is not hypothetical: it is what deleted
    // real `<img … >` tags carrying no `alt` from a Rails forum's bot translations in four
    // languages, in `.yml`, where YAML's own rule is that a comment needs whitespace before the `#`.
    if (ch === "#" && line[i - 1] === "&" && HTML_ENTITY.test(line.slice(i - 1))) continue;
    // `#{ … }` interpolation: skip to the matching `}`, tracking nesting and nested quotes.
    if (ch === "#" && line[i + 1] === "{") {
      let depth = 1;
      let inner: string | null = null;
      let j = i + 2;
      for (; j < line.length; j++) {
        const c = line[j];
        if (inner) {
          if (c === "\\") { j++; continue; }
          if (c === inner) inner = null;
          continue;
        }
        if (c === '"' || c === "'") { inner = c; continue; }
        if (c === "{") depth++;
        else if (c === "}" && --depth === 0) break;
      }
      i = j;
      continue;
    }
    if (ch === "#") return i;
  }
  return -1;
}

function stripHash(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const at = hashCommentStart(line);
      return at === -1 ? line : line.slice(0, at) + " ".repeat(line.length - at);
    })
    .join("\n");
}

/**
 * RUBY HAS A SECOND COMMENT FORM THAT `hash` NEVER KNEW, the embedded document `=begin … =end`, and
 * until 2026-09-24 `.rb` and `.rake` were registered as `hash` and nothing else.
 *
 * Found by the layer-1 architecture review of 2026-09-14: a `=begin … =end` block
 * saying "we never delete user data; there is no erasure endpoint" raised `eu-dsr-002` as though the
 * product executed the sentence — the exact case this file's header says the stripper exists to
 * suppress — and it could supply an `also_in_file` corroboration. `files_comment_syntax_unregistered`
 * could not see it: `.rb` IS registered, so the counter built to reveal unknown comment syntax read 0
 * for it by construction. The repair and its proof: an internal record.
 *
 * WHAT THE MODE IS: `hash`, unchanged, PLUS the block, blanked the way every other comment in this
 * file is blanked (a space per character, every newline kept). Composed rather than rewritten, the
 * way `hcl` is: the spans are found on the RAW text and blanked in `stripHash`'s output, which has the
 * same length, so outside a block the output is byte-for-byte what `hash` produced before and nothing
 * but a block can change. Both directions of that are asserted by a test.
 * Like every other comment in this file, a block is then a comment on the match side and to every
 * gate alike.
 *
 * A PYTHON DOCSTRING STAYS CODE, and `.py`/`.pyi` stay `hash`. The same
 * review named the docstring beside `=begin`, and a docstring finder was written and checked against
 * CPython's own parser over the corpus, but rules read docstring text on purpose: `eu-dsr-005`'s
 * fixture says so, and `eu-dsr-008` clause 13a was built on real docstrings in one tree,
 * which blanking them would stop seeing. Prose in a docstring is layer 2's to dismiss. The measurement
 * and the options that were weighed are in the same record.
 */
function blankSpans(text: string, spans: readonly (readonly [number, number])[]): string {
  if (spans.length === 0) return text;
  let out = "";
  let at = 0;
  for (const [from, to] of spans) {
    out += text.slice(at, from) + blank(text, from, to);
    at = to;
  }
  return out + text.slice(at);
}

/**
 * Ruby's embedded document: `=begin` in the FIRST COLUMN of a line opens it, the next line with
 * `=end` in its first column closes it, and both lines are part of it — AS RUBY'S OWN PARSER READS
 * IT. A `=begin` line is a block only where Prism (`ruby-prism.ts`) reports an embedded document,
 * and the block is exactly Prism's span: the `=begin` line's first character through the end of the
 * `=end` line. Inside a heredoc body or a string the same line is content, and blanking it would run
 * on through real code to the next column-0 `=end`: the miss two rounds of a hand-written tracker
 * each made, on forms Ruby reads differently,
 * which is why no tracker is left here.
 *
 * Prism runs only on a file holding a line that starts with `=begin` (the test, in `ruby-prism.ts`,
 * is wider than Ruby's own); every other file is read exactly as `hash` reads it. Every failure —
 * Prism missing or not loadable, any error Prism reports for the file (an unterminated `=begin`; a
 * byte-order mark before a line-1 `=begin`, which Prism 1.9.0 refuses where parse.y reads a comment),
 * a time-out, a reply that fails its check, a throw at any step — blanks nothing for that file, so
 * the file keeps main's reading and no code can be hidden. All of it, the `=begin` test included,
 * runs inside the one failure boundary, the `try` in `prismEmbdocSpans`; this function only calls it.
 */
export function rubyBlockCommentSpans(text: string): [number, number][] {
  return prismEmbdocSpans(text);
}

function stripRuby(text: string): string {
  return blankSpans(stripByKind(text, "hash", rubyCuts), rubyBlockCommentSpans(text));
}

/**
 * EACH FILE KIND'S OWN COMMENT RULE, read per kind (R11-E, 2026-11-11).
 *
 * THE CLASS. Until this day every kind registered `hash` was read by ONE rule, `hashCommentStart`: a
 * `#` outside a single-line quote pair starts a comment, anywhere on the line. That is Python's,
 * TOML's and Ruby's rule for one line, and it is not the rule of `.properties` (a comment is a whole
 * line), YAML (a comment needs whitespace before its `#`), dotenv (two of the three common readers
 * need the whitespace too), INI (configparser reads no inline comment by default) or shell (a `#` in
 * the middle of a word is part of the word). And no kind's rule stops at the line: a `#` line inside
 * a YAML block scalar, a TOML or Python triple-quoted string, a heredoc (shell, Ruby, Perl, HCL,
 * Dockerfile), a GraphQL block string or a `.properties` continuation line is CONTENT. Since the
 * match side reads this view as well as the raw line, every cut
 * the kind does not make is text no rule can match: `relay.smtp.password:XHq6Sxgh#8~...` reached
 * every rule as eight characters.
 *
 * THE MECHANISM, one for every kind. A kind's reader returns, per line, the column at which ITS
 * grammar starts a comment (or -1); the family reader (`hashCommentStart`, or the whole-line test for
 * the `line-hash` kinds) still runs, and a line is blanked from the LATER of the two columns, only
 * where both cut. So the view blanks a SUBSET of what it blanked before, by construction, in every
 * kind: no text is read less than before, and text the kind treats as content is no longer removed.
 * Where a reader cannot tell, it answers -1 (reads the line whole) or 0 (defers to the family reader,
 * which is the old reading). A construct that would run to the end of the file - a quote or heredoc
 * that never closes - is not entered, so a stray quote cannot un-blank the rest of a file.
 *
 * WHAT IS STILL CUT THAT THE KIND DOES NOT CUT, said rather than left to be found: whatever the
 * family reader leaves is a limit of these readers, not a decision. Each reader names its residue.
 */

const isBlankChar = (c: string | undefined): boolean => c === " " || c === "\t";
const noCR = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

/**
 * THE KIND READING'S OWN ALLOWANCE (E5). The readers below are a second
 * reading on top of the family reader, which is the reading every one of these kinds had before
 * 2026-11-11. They are built to run in time that grows with the file (the heredoc terminators and the
 * look-ahead for a close are indexed once per file; `test:comment-kinds` times every kind on hostile
 * files and fails on faster growth). Should one ever be slower than that, it must not cost the file its
 * reading: each reader's line loop reads this clock every 256 lines, and a kind reading that passes its
 * allowance is abandoned and the file gets the family reading, exactly the view it had before
 * 2026-11-11 (`commentView` says so in `kindReadingStopped`). The engine and the census do not charge
 * the kind reading's time to the file's budget (`kindReadingMs`), so a slow kind reading can never make
 * a file unread, or read less, than the family reading alone would have.
 *
 * THE VALUE: far above the slowest kind reading of any corpus file, so the answer for a real file is
 * the same on every machine (see the record for the measurement), and low enough that an abandoned
 * reading adds little to a scan.
 */
export const KIND_READING_ALLOWANCE_MS = 5_000;
let kindReadingStopsAt = Infinity;
const KIND_READING_STOPPED = new Error("kind reading passed its allowance");
function kindTick(k: number): void {
  if ((k & 255) === 0 && performance.now() >= kindReadingStopsAt) throw KIND_READING_STOPPED;
}

/** True when the line ends in an odd number of backslashes (the line terminator is escaped). */
function oddTrailingBackslashes(line: string): boolean {
  let n = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === "\\"; i--) n++;
  return n % 2 === 1;
}

/** Index of the closing `q` at or after `from`, a backslash escaping the next character; -1 if none. */
function closeEscaped(line: string, from: number, q: string): number {
  for (let j = from; j < line.length; j++) {
    if (line[j] === "\\") { j++; continue; }
    if (line.startsWith(q, j)) return j;
  }
  return -1;
}

/** For each character, the last line index holding it - so a construct that never closes is not entered. */
function lastLineHolding(lines: readonly string[], chars: string): Map<string, number> {
  const last = new Map<string, number>();
  for (let k = lines.length - 1; k >= 0 && last.size < chars.length; k--) {
    for (const c of chars) if (!last.has(c) && lines[k].includes(c)) last.set(c, k);
  }
  return last;
}

/**
 * A heredoc terminator finder over one file: `find(k, delim, how)` is the index of the first line after
 * `k` whose text (as it is, tabs stripped, or trimmed) is `delim`, or -1.
 *
 * BUILT ONCE PER FILE, NOT A SCAN PER OPENER (E5). Until 2026-11-12 each
 * opener scanned forward to the end of the file when its terminator did not exist, so a file of n
 * openers with no terminator cost n x n line reads: 16,000 such lines took 1.4-3.2 s, and a 1 MB file
 * would have passed the 60 s file budget in this pass alone, before any rule read a line. Now each line
 * form is indexed (line text -> ascending line numbers) the first time it is asked for, and a lookup is
 * a binary search: the same answer, in time that grows with the file.
 */
function terminatorFinder(lines: readonly string[]): (k: number, delim: string, how: "exact" | "tabs" | "trim") => number {
  const byHow = new Map<string, Map<string, number[]>>();
  return (k, delim, how) => {
    let index = byHow.get(how);
    if (!index) {
      index = new Map<string, number[]>();
      for (let j = 0; j < lines.length; j++) {
        kindTick(j);
        const t = noCR(lines[j]);
        const v = how === "exact" ? t : how === "tabs" ? t.replace(/^\t+/, "") : t.trim();
        const at = index.get(v);
        if (at) at.push(j);
        else index.set(v, [j]);
      }
      byHow.set(how, index);
    }
    const at = index.get(delim);
    if (!at) return -1;
    let lo = 0;
    let hi = at.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at[mid] > k) hi = mid;
      else lo = mid + 1;
    }
    return lo < at.length ? at[lo] : -1;
  };
}

/**
 * `text.indexOf(d, from) !== -1`, answered from the last place `d` occurs (found once per string): an
 * opener that looks ahead for its close no longer reads to the end of the file each time (E5).
 */
function occursFrom(text: string): (d: string, from: number) => boolean {
  const last = new Map<string, number>();
  return (d, from) => {
    let at = last.get(d);
    if (at === undefined) last.set(d, (at = text.lastIndexOf(d)));
    return at !== -1 && at >= from;
  };
}

/**
 * Lines a heredoc body covers, from openers found by `openers(line, k)` on lines not already inside
 * a body. Each opener's body runs from the line after the opener's line (after earlier openers'
 * bodies, in order) to its terminator line inclusive. An opener whose terminator does not exist is
 * dropped. Returns a per-line flag.
 */
function heredocBodies(
  lines: readonly string[],
  openers: (line: string, k: number) => { delim: string; how: "exact" | "tabs" | "trim" }[],
): boolean[] {
  const inBody = new Array<boolean>(lines.length).fill(false);
  const terminatorLine = terminatorFinder(lines);
  let k = 0;
  while (k < lines.length) {
    kindTick(k);
    const found = openers(noCR(lines[k]), k);
    let next = k + 1;
    for (const o of found) {
      const end = terminatorLine(next - 1, o.delim, o.how);
      if (end === -1) continue;
      for (let j = next; j <= end; j++) inBody[j] = true;
      next = end + 1;
    }
    k = next;
  }
  return inBody;
}

/**
 * `.properties` - `java.util.Properties.load(Reader)`: "A comment line has an ASCII '#' or '!' as its
 * first non-white space character"; a natural line ending in an odd number of backslashes continues
 * its logical line, and the continuation's leading white space is dropped, so a continuation line
 * that starts with `#` is value text; "a comment line cannot be extended in this manner". A `#`
 * anywhere else is part of a key or value. A blank continuation line ends the logical line.
 */
function propertiesCuts(lines: readonly string[]): number[] {
  const out: number[] = [];
  let continuing = false;
  for (let k = 0; k < lines.length; k++) {
    kindTick(k);
    const line = noCR(lines[k]);
    const lead = /^[ \t\f]*/.exec(line)![0].length;
    const blank = lead === line.length;
    if (!continuing && !blank && (line[lead] === "#" || line[lead] === "!")) {
      out.push(lead);
      continue;
    }
    out.push(-1);
    continuing = !blank && oddTrailingBackslashes(line);
  }
  return out;
}

/** Index of the closing quote of a YAML flow scalar: `''` escapes in single quotes, `\` in double. */
function yamlClose(line: string, from: number, q: string): number {
  if (q === '"') return closeEscaped(line, from, '"');
  for (let j = from; j < line.length; j++) {
    if (line[j] !== "'") continue;
    if (line[j + 1] === "'") { j++; continue; }
    return j;
  }
  return -1;
}

/**
 * Can a node (a quoted scalar, a flow collection) start at `i`: at the line's first token; after `:`,
 * `-` or `?` and white space; and, only inside a flow collection (`flow`), after `[`, `{` or `,`. Node
 * properties before it - a tag (`!…`) or an anchor (`&…`) - are passed over. Until 2026-11-12 a `[`,
 * `{` or `,` admitted a quote anywhere, so the `'` of a regular expression `(['"])` in a plain scalar
 * opened a "quoted scalar" that ran to the next quote and read the real comments in between as text;
 * and a quoted scalar after a tag was not followed, so its closing quote on a later line opened one (E1).
 */
function yamlNodeStart(line: string, i: number, flow: boolean): boolean {
  let at = i;
  for (;;) {
    let j = at - 1;
    while (j >= 0 && isBlankChar(line[j])) j--;
    if (j < 0) return true;
    // The token before is looked at only where
    // white space parts it from `at` (a property needs it): reading it back for every quote of a long unbroken token
    // made a line of quotes cost its length squared (lint:clause-cost's hostile `""""…` and `k"k"…`).
    if (j < at - 1) {
      let s = j;
      while (s > 0 && !isBlankChar(line[s - 1]) && !(flow && "[{,".includes(line[s - 1]))) s--;
      if (line[s] === "!" || line[s] === "&") { at = s; continue; }
    }
    const c = line[j];
    if (c === "[" || c === "{" || c === ",") return flow;
    if ((c === ":" || c === "-" || c === "?") && j < at - 1) return j === 0 || isBlankChar(line[j - 1]) || c === ":";
    return false;
  }
}

/** The block scalar indicator (`|`, `>`, with indentation and chomping indicators) as the rest of a line's code. */
const YAML_BLOCK_INDICATOR = /^[|>](?:[1-9][+-]?|[+-][1-9]?)?[ \t]*$/;

/** Past white space and node properties (tags `!…`, anchors `&…`, each followed by white space) from `p`. */
function yamlPastProperties(code: string, p: number): number {
  while (isBlankChar(code[p])) p++;
  while (code[p] === "!" || code[p] === "&") {
    let e = p;
    while (e < code.length && !isBlankChar(code[e])) e++;
    if (e === code.length) return p;
    p = e;
    while (isBlankChar(code[p])) p++;
  }
  return p;
}

/**
 * Does the code part of a line end in a block scalar header at its node's place: the line's first node,
 * a node after the block indicators `- `, `? ` or `: `, or a key's value after the key's `: ` (YAML 1.2.2
 * section 8.1). Until 2026-11-12 any `:`, `?` or `-` and white space before a final `|` or `>` was taken,
 * so a plain scalar ending `Continue? >` or `A - |` opened a block and its more-indented comment lines
 * were read as text (E2). A document may open with its node on the
 * document-start line (`--- |`, `--- !!str >`; YAML 1.2.2 section 9.1.4): the marker `---` at the line's
 * start and white space are passed over first, as the expression before 2026-11-12 took them; without
 * this the block's content lines were read as YAML and every ` #` in them blanked (checker F4's E2).
 */
function yamlBlockHeader(code: string): boolean {
  let p = code.startsWith("---") && isBlankChar(code[3]) ? 3 : 0;
  while (isBlankChar(code[p])) p++;
  while ((code[p] === "-" || code[p] === "?" || code[p] === ":") && (p + 1 === code.length || isBlankChar(code[p + 1]))) {
    p++;
    while (isBlankChar(code[p])) p++;
  }
  p = yamlPastProperties(code, p);
  if (YAML_BLOCK_INDICATOR.test(code.slice(p))) return true;
  let sep = -1;
  if (code[p] === '"' || code[p] === "'") {
    const end = yamlClose(code, p + 1, code[p]);
    if (end === -1) return false;
    let q = end + 1;
    while (isBlankChar(code[q])) q++;
    if (code[q] === ":" && isBlankChar(code[q + 1])) sep = q;
  } else {
    const m = /:[ \t]/.exec(code.slice(p));
    if (m) sep = p + m.index;
  }
  return sep !== -1 && YAML_BLOCK_INDICATOR.test(code.slice(yamlPastProperties(code, sep + 1)));
}

/**
 * YAML - YAML 1.2.2: section 6.6, "Comments must be separated from other tokens by white space
 * characters"; section 7.3.3, plain scalars "must never contain the ': ' and ' #' character
 * combinations" (so a `#` after a non-space character is scalar text); comments cannot occur inside
 * a quoted scalar (which may run over several lines, section 7.3) or inside a block scalar's content
 * (section 8.1: every line indented at least as far as its first non-empty line, the content
 * indentation). A byte order mark may open the stream (section 5.2), so line 1 is read after it (E3). Flow collections (`[…]`, `{…}`, over lines too) are followed, so
 * that `[`, `{` and `,` start a node only inside one (E1). Residue: an explicit indentation indicator
 * is read as auto-detected; a line that opens with a quote inside a multi-line plain scalar is read as
 * opening a quoted scalar.
 */
function yamlCuts(lines: readonly string[]): number[] {
  const out: number[] = [];
  const last = lastLineHolding(lines, `"'`);
  let block: { parent: number; indent: number } | null = null;
  let quote: string | null = null;
  let flow = 0;
  for (let k = 0; k < lines.length; k++) {
    kindTick(k);
    const bom = k === 0 && lines[0].charCodeAt(0) === 0xfeff ? 1 : 0;
    const line = noCR(bom ? lines[0].slice(1) : lines[k]);
    if (/^(?:---|\.\.\.)(?:[ \t]|$)/.test(line)) flow = 0;
    if (block) {
      const ind = /^ */.exec(line)![0].length;
      if (line.trim() === "") { out.push(-1); continue; }
      if (block.indent === -1 && ind > block.parent) block.indent = ind;
      if (block.indent !== -1 && ind >= block.indent) { out.push(-1); continue; }
      block = null;
    }
    let i = 0;
    if (quote) {
      const end = yamlClose(line, 0, quote);
      if (end === -1) { out.push(-1); continue; }
      quote = null;
      i = end + 1;
    }
    let cut = -1;
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === "#" && (i === 0 || isBlankChar(line[i - 1]))) { cut = i; break; }
      if ((c === "[" || c === "{") && yamlNodeStart(line, i, flow > 0)) { flow++; continue; }
      if ((c === "]" || c === "}") && flow > 0) { flow--; continue; }
      if ((c === '"' || c === "'") && yamlNodeStart(line, i, flow > 0)) {
        const end = yamlClose(line, i + 1, c);
        if (end === -1) {
          if ((last.get(c) ?? -1) > k) quote = c;
          break;
        }
        i = end;
      }
    }
    out.push(cut === -1 ? -1 : cut + bom);
    if (quote) continue;
    const code = cut === -1 ? line : line.slice(0, cut);
    if (yamlBlockHeader(code)) {
      const m = /^([ \t]*)((?:-[ \t]+)*)/.exec(code)!;
      const rest = code.slice(m[0].length);
      const parent = /^[|>]/.test(rest) && m[2] !== "" ? m[0].length - 2 : m[0].length;
      block = { parent, indent: -1 };
    }
  }
  return out;
}

/** `KEY=` / `export KEY=` / `KEY: ` at the start of a dotenv line; the value starts after it. */
const DOTENV_HEAD = /^[ \t]*(?:export[ \t]+)?[\w.-]+[ \t]*(?:=[ \t]*|:[ \t]+)/;

/**
 * dotenv - no single specification, so a `#` is read as a comment only where the three common
 * readers agree. Node's `dotenv` (its `LINE` expression: an unquoted value is `[^#\r\n]+`, so any `#`
 * ends it; quoted values in `'`, `"` and backticks may span lines); `python-dotenv` (its parser: a
 * whole-line comment is optional white space then `#`; an unquoted value is cut only by `\s+#`; both
 * quoted forms span lines); Docker Compose's `.env` ("Lines beginning with # are processed as
 * comments"; "Inline comments for unquoted values must be preceded with a space"; "Inline comments
 * for quoted values must follow the closing quote"). Agreed: a `#` that begins the line's first
 * token, or follows white space, or follows a value's closing quote, outside a quoted value.
 */
function dotenvCuts(lines: readonly string[]): number[] {
  const out: number[] = [];
  const last = lastLineHolding(lines, `"'\``);
  let quote: string | null = null;
  for (let k = 0; k < lines.length; k++) {
    kindTick(k);
    const line = noCR(lines[k]);
    let i = 0;
    let afterQuote = -1;
    if (quote) {
      const end = closeEscaped(line, 0, quote);
      if (end === -1) { out.push(-1); continue; }
      quote = null;
      i = afterQuote = end + 1;
    } else {
      const m = DOTENV_HEAD.exec(line);
      if (m) {
        i = m[0].length;
        const c = line[i];
        if (c === '"' || c === "'" || c === "`") {
          const end = closeEscaped(line, i + 1, c);
          if (end === -1) {
            if ((last.get(c) ?? -1) > k) quote = c;
            out.push(-1);
            continue;
          }
          i = afterQuote = end + 1;
        }
      }
    }
    let cut = -1;
    for (; i < line.length; i++) {
      if (line[i] === "#" && (i === 0 || isBlankChar(line[i - 1]) || i === afterQuote)) { cut = i; break; }
    }
    out.push(cut);
  }
  return out;
}

/**
 * INI - no single specification. Python's `configparser` (the reader of most `.ini` files in source
 * trees: `setup.cfg`, `tox.ini`, `pytest.ini`, `alembic.ini`): "Comments may appear on their own on
 * an otherwise empty line, possibly indented", prefixed by `#` or `;`; `inline_comment_prefixes`
 * defaults to None, so a `#` inside a value is value text. Read: a line whose first non-blank
 * character is `#` or `;`. Residue: PHP's `parse_ini_file` reads a `#` line as a key since PHP 7.0;
 * that line is still blanked, as before.
 */
function iniCuts(lines: readonly string[]): number[] {
  return lines.map((raw, k) => {
    kindTick(k);
    const m = /^[ \t]*[#;]/.exec(raw);
    return m ? m[0].length - 1 : -1;
  });
}

/**
 * Tinybird `.datasource` - its datafile reference: "You can add comments using the # character",
 * every example a whole line. A `#` inside an instruction's value (a `DEFAULT '#fff'`, a JSONPath)
 * is read as text. Residue: an indented `#` line inside a multi-line `>` block is still blanked.
 */
function lineStartHashCuts(lines: readonly string[]): number[] {
  return lines.map((raw, k) => {
    kindTick(k);
    const m = /^[ \t]*#/.exec(raw);
    return m ? m[0].length - 1 : -1;
  });
}

/** Past the closing TOML multi-line delimiter at or after `from` (up to two extra quotes are content), or -1. */
function tomlMlClose(line: string, from: number, d: string): number {
  for (let j = from; j < line.length; j++) {
    if (d === '"""' && line[j] === "\\") { j++; continue; }
    if (line.startsWith(d, j)) {
      let e = j + 3;
      while (e < line.length && e < j + 5 && line[e] === d[0]) e++;
      return e;
    }
  }
  return -1;
}

/**
 * TOML - TOML v1.0.0, Comment: "A hash symbol marks the rest of the line as a comment, except when
 * inside a string." Strings: basic `"…"` (backslash escapes), literal `'…'`, and the multi-line
 * forms `"""…"""` and `'''…'''`, which run over lines - so a `#` line inside one is string text.
 */
function tomlCuts(lines: readonly string[]): number[] {
  const out: number[] = [];
  const text = lines.join("\n");
  const occurs = occursFrom(text);
  let ml: string | null = null;
  let offset = 0;
  for (let k = 0; k < lines.length; offset += lines[k].length + 1, k++) {
    kindTick(k);
    const line = noCR(lines[k]);
    let i = 0;
    let cut = -1;
    if (ml) {
      const end = tomlMlClose(line, 0, ml);
      if (end === -1) { out.push(-1); continue; }
      ml = null;
      i = end;
    }
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === "#") { cut = i; break; }
      if (c !== '"' && c !== "'") continue;
      if (line.startsWith(c.repeat(3), i)) {
        const d = c.repeat(3);
        const end = tomlMlClose(line, i + 3, d);
        if (end === -1) {
          if (occurs(d, offset + i + 3)) ml = d;
          break;
        }
        i = end - 1;
        continue;
      }
      const end = c === '"' ? closeEscaped(line, i + 1, '"') : line.indexOf("'", i + 1);
      if (end === -1) break;
      i = end;
    }
    out.push(cut);
  }
  return out;
}

/** Python's string close: `d` is a quote or a triple quote; a backslash escapes the next character. */
function pyClose(line: string, from: number, d: string): number {
  for (let j = from; j < line.length; j++) {
    if (line[j] === "\\") { j++; continue; }
    if (line.startsWith(d, j)) return j + d.length;
  }
  return -1;
}

/**
 * Python - The Python Language Reference, 2.1.3 Comments: "A comment starts with a hash character
 * (#) that is not part of a string literal, and ends at the end of the physical line." A triple-
 * quoted string runs over lines, and a quoted string continues over a backslash-newline, so a `#`
 * line inside one (a docstring's example, a doctest's `>>> # …`) is string text - which the owner's
 * decision of 2026-09-24 already reads as code. Residue: a `#` inside an f-string replacement field.
 */
function pythonCuts(lines: readonly string[]): number[] {
  const out: number[] = [];
  const text = lines.join("\n");
  const occurs = occursFrom(text);
  let ml: string | null = null;
  let offset = 0;
  for (let k = 0; k < lines.length; offset += lines[k].length + 1, k++) {
    kindTick(k);
    const line = noCR(lines[k]);
    let i = 0;
    let cut = -1;
    if (ml) {
      const end = pyClose(line, 0, ml);
      if (end === -1) {
        out.push(-1);
        if (ml.length === 1 && !oddTrailingBackslashes(line)) ml = null;
        continue;
      }
      ml = null;
      i = end;
    }
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === "#") { cut = i; break; }
      if (c !== '"' && c !== "'") continue;
      const d = line.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      const end = pyClose(line, i + d.length, d);
      if (end === -1) {
        if (d.length === 3 ? occurs(d, offset + i + 3) : oddTrailingBackslashes(line)) ml = d;
        break;
      }
      i = end - 1;
    }
    out.push(cut);
  }
  return out;
}

/** Skip an Elixir/Ruby `#{ … }` interpolation starting at `j` (the `#`): the index of its `}`, or the line's end. */
function skipInterpolation(line: string, j: number): number {
  let depth = 0;
  let inner: string | null = null;
  for (let e = j + 1; e < line.length; e++) {
    const c = line[e];
    if (inner) {
      if (c === "\\") { e++; continue; }
      if (c === inner) inner = null;
      continue;
    }
    if (c === '"' || c === "'") { inner = c; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return e;
  }
  return line.length;
}

const BRACKET_CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };

/**
 * Elixir - its syntax reference: "Comments start with # and end at the end of the line", outside
 * strings, charlists and sigils. A double-quoted string or charlist may run over lines; a heredoc
 * (`"""` or `'''`, also after a sigil, as in `@moduledoc """` and `~H"""`) runs to a line that starts
 * with the closing triple quote; a sigil runs to its closing delimiter. A `#` line inside any of them
 * (a `## Examples` heading in `@moduledoc`) is text. `?#` is the character literal for `#`.
 */
function elixirCuts(lines: readonly string[]): number[] {
  const out: number[] = [];
  const text = lines.join("\n");
  const occurs = occursFrom(text);
  let state: { close: string; open?: string; depth: number; heredoc: boolean; interp: boolean } | null = null;
  let offset = 0;
  for (let k = 0; k < lines.length; offset += lines[k].length + 1, k++) {
    kindTick(k);
    const line = noCR(lines[k]);
    let i = 0;
    let cut = -1;
    if (state) {
      if (state.heredoc) {
        if (line.trimStart().startsWith(state.close)) { i = line.indexOf(state.close) + 3; state = null; }
        else { out.push(-1); continue; }
      } else {
        const end = elixirClose(line, 0, state);
        if (end === -1) { out.push(-1); continue; }
        state = null;
        i = end + 1;
      }
    }
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === "?" && (i === 0 || !/[\w?!]/.test(line[i - 1])) && i + 1 < line.length) { i += line[i + 1] === "\\" ? 2 : 1; continue; }
      if (c === "#") { cut = i; break; }
      let open = "";
      let interp = true;
      let at = i;
      if (c === "~" && /[a-zA-Z]/.test(line[i + 1] ?? "")) {
        let s = i + 1;
        while (s < line.length && /[a-zA-Z]/.test(line[s])) s++;
        interp = /[a-z]/.test(line[i + 1]);
        at = s;
        open = line[s] ?? "";
        if (open === "" || !`/|"'([{<`.includes(open)) continue;
      } else if (c === '"' || c === "'") {
        open = c;
      } else {
        continue;
      }
      if ((open === '"' || open === "'") && line.startsWith(open.repeat(3), at)) {
        const d = open.repeat(3);
        if (line.slice(at + 3).trim() === "" && occurs(d, offset + at + 3)) {
          state = { close: d, depth: 0, heredoc: true, interp };
        }
        break;
      }
      const close = BRACKET_CLOSE[open] ?? open;
      const st = { close, open: BRACKET_CLOSE[open] ? open : undefined, depth: 1, heredoc: false, interp };
      const end = elixirClose(line, at + 1, st);
      if (end === -1) {
        if (occurs(close, offset + line.length)) state = st;
        break;
      }
      i = end;
    }
    out.push(cut);
  }
  return out;
}

/** The closing delimiter's index for an Elixir string or sigil state (nesting for bracket pairs), or -1. Updates the depth. */
function elixirClose(line: string, from: number, st: { close: string; open?: string; depth: number; interp: boolean }): number {
  for (let j = from; j < line.length; j++) {
    const c = line[j];
    if (c === "\\") { j++; continue; }
    if (st.interp && c === "#" && line[j + 1] === "{") { j = skipInterpolation(line, j); continue; }
    if (st.open && c === st.open) { st.depth++; continue; }
    if (c === st.close && --st.depth === 0) return j;
  }
  return -1;
}

const SH_HEREDOC = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z0-9_][\w.-]*))/;

/**
 * Shell's comment test for one line from `from`: POSIX Shell Command Language 2.3, Token Recognition,
 * rule 9 - a `#` that would begin a new token begins a comment; rule 8 - a `#` after a character of
 * a word is appended to the word (`a#b`, `$#`, `${#x}`, `${x#y}`, `url/#frag`). Quotes (2.2) are
 * followed; heredoc openers (2.7.4) are reported. `prevWord` says a backslash-newline continued a
 * word into this line. Returns the cut, the quote left open at the line's end, and the openers.
 */
function shellLine(line: string, from: number, prevWord: boolean): { cut: number; open: string | null; heredocs: { delim: string; how: "exact" | "tabs" }[] } {
  const heredocs: { delim: string; how: "exact" | "tabs" }[] = [];
  let arith = 0;
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") { i++; continue; }
    if (c === "#") {
      const before = i === 0 ? (prevWord ? "w" : " ") : line[i - 1];
      if (/[ \t;&|()<>]/.test(before)) return { cut: i, open: null, heredocs };
      continue;
    }
    if (c === "'") {
      const end = line[i - 1] === "$" ? closeEscaped(line, i + 1, "'") : line.indexOf("'", i + 1);
      if (end === -1) return { cut: -1, open: "'", heredocs };
      i = end;
      continue;
    }
    if (c === '"') {
      const end = closeEscaped(line, i + 1, '"');
      if (end === -1) return { cut: -1, open: '"', heredocs };
      i = end;
      continue;
    }
    // `$((` opens an arithmetic expansion, where `<<` is a shift (2.6.4); its parentheses are counted.
    if (c === "$" && line[i + 1] === "(" && line[i + 2] === "(" && arith === 0) { arith = 2; i += 2; continue; }
    if (c === "(" && arith > 0) { arith++; continue; }
    if (c === ")" && arith > 0) { arith--; continue; }
    // A here-string `<<<` (bash) opens no heredoc; until 2026-11-12 its last two `<` were read as one (E4).
    if (c === "<" && line[i + 1] === "<" && line[i + 2] === "<") { i += 2; continue; }
    if (c === "<" && line[i + 1] === "<" && arith === 0) {
      const m = SH_HEREDOC.exec(line.slice(i));
      if (m) {
        heredocs.push({ delim: m[2] ?? m[3] ?? m[4], how: m[1] === "-" ? "tabs" : "exact" });
        i += m[0].length - 1;
      }
    }
  }
  return { cut: -1, open: null, heredocs };
}

/**
 * Shell (`.sh`, `.bash`) - `shellLine` above for each line; a quote left open runs to its close on a
 * later line (2.2.2, 2.2.3), and a heredoc body runs to its delimiter line (2.7.4), each only where
 * that close exists. Residue: a `#` inside `$(…)` nested in a double quote is read by the quote.
 */
function shellCuts(lines: readonly string[]): number[] {
  const out = new Array<number>(lines.length).fill(-1);
  const last = lastLineHolding(lines, `"'`);
  const terminatorLine = terminatorFinder(lines);
  let quote: string | null = null;
  let prevWord = false;
  for (let k = 0; k < lines.length; k++) {
    kindTick(k);
    const line = noCR(lines[k]);
    let from = 0;
    if (quote) {
      const end = quote === "'" ? line.indexOf("'") : closeEscaped(line, 0, '"');
      if (end === -1) continue;
      quote = null;
      from = end + 1;
    }
    const r = shellLine(line, from, prevWord);
    out[k] = r.cut;
    if (r.open && (last.get(r.open) ?? -1) > k) quote = r.open;
    prevWord = r.cut === -1 && !quote && oddTrailingBackslashes(line) && !/[ \t]\\$/.test(line);
    let next = k;
    for (const h of r.heredocs) {
      const end = terminatorLine(next, h.delim, h.how);
      if (end === -1) continue;
      for (let j = next + 1; j <= end; j++) out[j] = -1;
      next = end;
    }
    if (next !== k) { k = next; prevWord = false; }
  }
  return out;
}

const MAKE_DEFINE = /^[ \t]*(?:(?:override|export|private|undefine)[ \t]+)*define(?:[ \t]|$)/;

/**
 * Makefile - GNU make manual, 3.1 What Makefiles Contain: "'#' in a line of a makefile starts a
 * comment", a trailing backslash continuing the comment; "Comments within a recipe are passed to the
 * shell"; "Within a define directive, comments are not ignored during the definition of the
 * variable". 4.1 / 6.1: a backslash escapes `#` (`\#`). So outside a recipe a `#` not escaped by a
 * backslash is a comment wherever it is (make knows no quotes, so the quote-aware family reader keeps
 * a quoted `#`: reading more); a recipe line (tab-initial, 5.1) is read by `shellLine`; a `define`
 * body is text.
 */
function makefileCuts(lines: readonly string[]): number[] {
  const out: number[] = [];
  let define = 0;
  let commentCont = false;
  let recipeCont = false;
  for (let k = 0; k < lines.length; k++) {
    kindTick(k);
    const line = noCR(lines[k]);
    if (define > 0) {
      if (/^[ \t]*endef(?:[ \t#]|$)/.test(line)) define--;
      else if (MAKE_DEFINE.test(line)) define++;
      out.push(-1);
      continue;
    }
    if (commentCont) {
      out.push(0);
      commentCont = oddTrailingBackslashes(line);
      continue;
    }
    if (line.startsWith("\t") || recipeCont) {
      const r = shellLine(line, 0, false);
      out.push(r.cut);
      recipeCont = r.cut === -1 && oddTrailingBackslashes(line);
      continue;
    }
    let cut = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "#") continue;
      let n = 0;
      for (let b = i - 1; b >= 0 && line[b] === "\\"; b--) n++;
      if (n % 2 === 0) { cut = i; break; }
    }
    out.push(cut);
    if (MAKE_DEFINE.test(cut === -1 ? line : line.slice(0, cut))) define = 1;
    if (cut !== -1) commentCont = oddTrailingBackslashes(line);
  }
  return out;
}

const RB_HEREDOC = /<<([~-]?)(?:(['"`])([^'"`\n]+)\2|([A-Za-z_]\w*))/g;

/**
 * Ruby - its syntax documentation (comments.rdoc: "Inline comments start with the # character and
 * continue until the end of the line"; literals.rdoc, Here Documents: `<<~ID`, `<<-ID` and `<<ID`,
 * quoted or not, the body running to the line holding only the identifier, indented for `~`/`-`).
 * A heredoc body is string text, so a `#` line in one is not a comment. Everything else defers to
 * the family reader (0). A bare `<<ID` is taken only with an upper-case identifier after white
 * space, `(`, `,` or `=`, and any opener only where its terminator line exists, so `list <<FOO`
 * (a shift) is not read as a heredoc unless a `FOO` line follows. Residue: a `#` line inside a quoted
 * string or `%` literal running over lines is still cut.
 */
function rubyCuts(lines: readonly string[]): number[] {
  const body = heredocBodies(lines, (line) => {
    const at = hashCommentStart(line);
    const code = at === -1 ? line : line.slice(0, at);
    const found: { delim: string; how: "exact" | "trim" }[] = [];
    for (const m of code.matchAll(RB_HEREDOC)) {
      const before = code[m.index! - 1];
      const bare = m[1] === "" && m[2] === undefined;
      if (bare && !(/^[A-Z_]/.test(m[4]) && (m.index === 0 || /[ \t(,=]/.test(before)))) continue;
      if (code.slice(m.index! - 1, m.index!) === "<") continue;
      found.push({ delim: m[3] ?? m[4], how: m[1] === "" ? "exact" : "trim" });
    }
    return found;
  });
  return body.map((b) => (b ? -1 : 0));
}

const PERL_HEREDOC = /<<(~?)(?:[ \t]*"([^"\n]*)"|[ \t]*'([^'\n]*)'|([A-Za-z_]\w*))/g;

/**
 * Perl - perlsyn, Comments: "Text from a "#" character until the end of the line is a comment ...
 * Exceptions include "#" inside a string or regular expression"; perlop, Here-documents (`<<"ID"`,
 * `<<'ID'`, `<<ID`, `<<~ID`; the body ends at a line holding only the identifier, indented for `~`);
 * perldata, `__END__` and `__DATA__`: the rest of the file is data. The family is `line-hash`
 * (whole `#` lines only); a heredoc body and the data section are no longer cut. Residue: a `#` line
 * inside a quoted string or `q{…}` running over lines.
 */
function perlCuts(lines: readonly string[]): number[] {
  const out = heredocBodies(lines, (line) => {
    if (/^=[A-Za-z]/.test(line)) return [];
    const at = hashCommentStart(line);
    const code = at === -1 ? line : line.slice(0, at);
    const found: { delim: string; how: "exact" | "trim" }[] = [];
    for (const m of code.matchAll(PERL_HEREDOC)) found.push({ delim: m[2] ?? m[3] ?? m[4], how: m[1] === "~" ? "trim" : "exact" });
    return found;
  }).map((b) => (b ? -1 : 0));
  const data = lines.findIndex((l) => /^__(?:END|DATA)__[ \t\r]*$/.test(l));
  if (data !== -1) for (let k = data + 1; k < lines.length; k++) out[k] = -1;
  return out;
}

const DOCKER_HEREDOC = /<<(-?)(["']?)([A-Za-z_][\w-]*)\2/g;

/**
 * Dockerfile - the Dockerfile reference, Format: "BuildKit treats lines that begin with # as a
 * comment, unless the line is a valid parser directive. A # marker anywhere else in a line is
 * treated as an argument"; Parser directives (`syntax`, `escape`, `check`, read only before the first
 * comment, blank line or instruction); Here-documents (`<<EOF`, `<<-EOF`, quoted or not, in `RUN`
 * and `COPY`: the body runs to the delimiter line and is passed on, `#` lines included).
 */
function dockerfileCuts(lines: readonly string[]): number[] {
  const out = heredocBodies(lines, (line) => {
    if (/^[ \t]*#/.test(line)) return [];
    const found: { delim: string; how: "exact" | "tabs" }[] = [];
    for (const m of line.matchAll(DOCKER_HEREDOC)) found.push({ delim: m[3], how: m[1] === "-" ? "tabs" : "exact" });
    return found;
  }).map((b) => (b ? -1 : 0));
  for (let k = 0; k < lines.length && /^[ \t]*#[ \t]*(?:syntax|escape|check)[ \t]*=/i.test(lines[k]); k++) out[k] = -1;
  return out;
}

/**
 * GraphQL - GraphQL specification (October 2021), 2.1.6 Comments ("starting with the # marker", a
 * source character outside a string) and 2.9.4 Block strings (`"""…"""` over lines; `\"""` escapes
 * the delimiter). The family is `line-hash`; a `#` line inside a block string (a Markdown heading in
 * a description) is no longer cut.
 */
function graphqlCuts(lines: readonly string[]): number[] {
  const out: number[] = [];
  const text = lines.join("\n");
  const occurs = occursFrom(text);
  let inBlock = false;
  let offset = 0;
  for (let k = 0; k < lines.length; offset += lines[k].length + 1, k++) {
    kindTick(k);
    const line = noCR(lines[k]);
    out.push(inBlock ? -1 : 0);
    let i = 0;
    for (;;) {
      if (inBlock) {
        const end = closeEscaped(line, i, '"""');
        if (end === -1) break;
        inBlock = false;
        i = end + 3;
        continue;
      }
      let next = -1;
      for (let j = i; j < line.length; j++) {
        const c = line[j];
        if (c === "#") break;
        if (c !== '"') continue;
        if (line.startsWith('"""', j)) { next = j; break; }
        const end = closeEscaped(line, j + 1, '"');
        if (end === -1) break;
        j = end;
      }
      if (next === -1 || !occurs('"""', offset + next + 3)) break;
      inBlock = true;
      i = next + 3;
    }
  }
  return out;
}

/** Blank only where both views blank: `a` and `b` are views of `text` of the same length. */
function blankWhereBoth(text: string, a: string, b: string): string {
  if (a === text || b === text) return text;
  const parts: string[] = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (a[i] !== text[i] && b[i] === text[i]) {
      if (i > from) parts.push(a.slice(from, i));
      parts.push(text[i]);
      from = i + 1;
    }
  }
  parts.push(a.slice(from));
  return parts.join("");
}

/** `text` with the flagged lines blanked to spaces, so a stripper sees no comment marker there. */
function maskLines(lines: readonly string[], flagged: readonly boolean[]): string {
  return lines.map((l, k) => (flagged[k] ? l.replace(/[^\r]/g, " ") : l)).join("\n");
}

/** `view` with the flagged lines restored from `lines`. */
function restoreLines(view: string, lines: readonly string[], flagged: readonly boolean[]): string {
  return view.split("\n").map((l, k) => (flagged[k] ? lines[k] : l)).join("\n");
}

/**
 * Is `at` inside a quoted string of an HCL line (comments already blanked): an odd number of unescaped
 * `"` before it. A quoted template cannot span lines, and the strings inside its `${…}` interpolations
 * come in pairs, so the parity is the string state (E4: `"<<EOT"` opened
 * a heredoc).
 */
function insideHclString(line: string, at: number): boolean {
  let odd = false;
  for (let j = 0; j < at; j++) {
    if (line[j] === "\\") { j++; continue; }
    if (line[j] === '"') odd = !odd;
  }
  return odd;
}

/**
 * HCL and Terraform - HCL native syntax specification, Comments and Whitespace: `#` and `//` to end
 * of line, `/* … *\/`; Template Expressions: a heredoc (`<<EOT`, `<<-EOT`) runs to a line holding
 * only the marker, white space allowed. A heredoc body (a script, a policy document) is template
 * text: no comment form opens there. The opener must survive the family reading (so it is code).
 */
function stripHclKind(text: string): string {
  const old = stripHcl(text);
  if (!text.includes("<<")) return old;
  const lines = text.split("\n");
  const oldLines = old.split("\n");
  const body = heredocBodies(lines, (line, k) => {
    const found: { delim: string; how: "trim" }[] = [];
    for (const m of line.matchAll(/<<-?([A-Za-z_][\w-]*)/g)) {
      if (oldLines[k].startsWith(m[0], m.index!) && !insideHclString(oldLines[k], m.index!)) found.push({ delim: m[1], how: "trim" });
    }
    return found;
  });
  if (!body.includes(true)) return old;
  const spec = restoreLines(stripHcl(maskLines(lines, body)), lines, body);
  return blankWhereBoth(text, old, spec);
}

const HJSON_LITERAL = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[ \t]*(?:$|,|\]|\}|#|\/\/|\/\*)/;

/**
 * Hjson - its syntax page: "Hash # or C style // comments start a single line comment", "/* starts
 * a multiline comment"; a quoteless string runs to the end of its line and "X # not a comment is the
 * string "X # not a comment""; `'''` starts a multiline string. So a quoteless value's line and a
 * multiline string's lines are masked from the comment readers; a value that is a number, `true`,
 * `false` or `null` may be followed by a comment.
 */
function stripHjson(text: string): string {
  const old = stripHcl(text);
  const lines = text.split("\n");
  const masked = lines.slice();
  let ml = false;
  let any = false;
  const mask = (k: number, from: number, to: number): void => {
    masked[k] = masked[k].slice(0, from) + " ".repeat(to - from) + masked[k].slice(to);
    any = true;
  };
  for (let k = 0; k < lines.length; k++) {
    kindTick(k);
    const line = noCR(lines[k]);
    let i = 0;
    if (ml) {
      const end = line.indexOf("'''");
      if (end === -1) { mask(k, 0, line.length); continue; }
      mask(k, 0, end);
      ml = false;
      i = end + 3;
    }
    while (i < line.length) {
      const c = line[i];
      if (isBlankChar(c) || "{}[],:".includes(c)) { i++; continue; }
      if (c === "#" || (c === "/" && (line[i + 1] === "/" || line[i + 1] === "*"))) break;
      if (c === '"' || c === "'") {
        if (c === "'" && line.startsWith("'''", i)) {
          const end = line.indexOf("'''", i + 3);
          if (end === -1) { mask(k, i, line.length); ml = true; break; }
          mask(k, i, end);
          i = end + 3;
          continue;
        }
        const end = closeEscaped(line, i + 1, c);
        if (end === -1) break;
        i = end + 1;
        continue;
      }
      const key = /^[^\s{}[\],:]+[ \t]*:/.exec(line.slice(i));
      if (key) { i += key[0].length; continue; }
      const lit = HJSON_LITERAL.exec(line.slice(i));
      if (lit) { i += /^[^ \t,\]}#/]+/.exec(line.slice(i))![0].length; continue; }
      mask(k, i, line.length);
      break;
    }
  }
  if (!any) return old;
  const spec = stripHcl(masked.join("\n"));
  const specLines = spec.split("\n");
  const restored = lines.map((l, k) => {
    if (masked[k] === l) return specLines[k];
    let out = "";
    for (let j = 0; j < l.length; j++) out += masked[k][j] !== l[j] ? l[j] : specLines[k][j];
    return out;
  });
  return blankWhereBoth(text, old, restored.join("\n"));
}

/** Blank a line from the later of the family reader's cut and the kind's own, only where both cut. */
function stripByKind(text: string, family: "hash" | "line-hash", cuts: (lines: readonly string[]) => number[]): string {
  const lines = text.split("\n");
  const spec = cuts(lines);
  for (let k = 0; k < lines.length; k++) {
    kindTick(k);
    const line = lines[k];
    const old = family === "hash" ? hashCommentStart(line) : /^[ \t]*#/.test(line) ? 0 : -1;
    if (old === -1 || spec[k] === -1) continue;
    const from = Math.max(old, spec[k]);
    if (from < line.length) lines[k] = line.slice(0, from) + " ".repeat(line.length - from);
  }
  return lines.join("\n");
}

/**
 * The family reader's view, exported for the tests that compare a kind's reading against it: the
 * `hash` reading every kind of that family had until 2026-11-11.
 */
export function hashFamilyView(text: string): string {
  return stripHash(text);
}

const KIND_CUTS: Partial<Record<Syntax, { family: "hash" | "line-hash"; cuts: (lines: readonly string[]) => number[] }>> = {
  properties: { family: "hash", cuts: propertiesCuts },
  yaml: { family: "hash", cuts: yamlCuts },
  dotenv: { family: "hash", cuts: dotenvCuts },
  ini: { family: "hash", cuts: iniCuts },
  datasource: { family: "hash", cuts: lineStartHashCuts },
  toml: { family: "hash", cuts: tomlCuts },
  python: { family: "hash", cuts: pythonCuts },
  elixir: { family: "hash", cuts: elixirCuts },
  shell: { family: "hash", cuts: shellCuts },
  makefile: { family: "hash", cuts: makefileCuts },
  perl: { family: "line-hash", cuts: perlCuts },
  dockerfile: { family: "line-hash", cuts: dockerfileCuts },
  graphql: { family: "line-hash", cuts: graphqlCuts },
};

/**
 * `--` to end of line, plus `/* … *​/` blocks. SQL escapes a quote by doubling it, which falls out
 * of treating the second one as a fresh open; an unterminated quote closes at the newline so that a
 * stray apostrophe in a comment cannot swallow the rest of the file. Mirrors the `sql` mode
 * a check already carried, so the two tables do not disagree about what a
 * comment is.
 */
function stripSql(text: string): string {
  let out = "";
  let quote: string | null = null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === quote || ch === "\n") quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; i++; continue; }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const j = end === -1 ? text.length : end + 2;
      out += blank(text, i, j);
      i = j;
      continue;
    }
    if (ch === "-" && text[i + 1] === "-") {
      let j = i;
      while (j < text.length && text[j] !== "\n") j++;
      out += blank(text, i, j);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * `#` only where it is the first non-blank character of a line. For formats in which a mid-line `#`
 * is data rather than a comment — Dockerfile's `RUN curl https://x/#frag` is the standing example —
 * cutting at it would delete content, which is the direction this file's header calls the dangerous
 * one.
 */
function stripLineHash(text: string): string {
  return text
    .split("\n")
    .map((line) => (/^[ \t]*#/.test(line) ? " ".repeat(line.length) : line))
    .join("\n");
}

/**
 * HCL and Terraform, which have all three comment forms: `#` to end of line, `//` to end of line,
 * and `/* … *​/`. Composed rather than rewritten — `stripHash` first, then `stripCLike` over its
 * output — because both preserve length and newlines exactly, so composing them cannot shift a line
 * number, and each half stays the same code the rest of this file is tested on.
 */
function stripHcl(text: string): string {
  return stripCLike(stripHash(text), true);
}

/**
 * PHP's THIRD comment form, `#` to end of line, which `stripCLike` has never known about.
 *
 * `stripCLike` IS NOT TAUGHT ABOUT `#`, AND THAT IS THE WHOLE DESIGN. The `c-like` mode is shared by
 * `js, ts, tsx, go, java, kt, cs, swift, rs, scala, c, h, cc, cpp, hpp, m, mm, dart, prisma, gjs,
 * gts` and more, and in C, C++ and Objective-C `#include`, `#define`, `#ifdef` are PREPROCESSOR
 * DIRECTIVES — real code, and often the only place a guard can see which library a file pulls in.
 * Rust writes `#[derive(…)]` and C# writes `#region`, and both are code too. This was priced rather
 * than asserted: a build of `stripCLike` that cuts at `#` was made on 2026-08-13 and it blanks
 * **338,312 lines across 12,637 corpus `.c`, `.h`, `.cc`, `.cpp`, `.hpp`, `.m`, `.mm`, `.rs`, `.cs`,
 * `.swift`, `.kt` and `.kts` files** — the over-stripping direction the header of this file calls
 * the invisible failure. So this is a separate mode, composed exactly the way `stripHcl` is composed
 * and for the same stated reason: `stripPhpHash` blanks `#` comments and nothing else, `stripCLike`
 * then does the `//` and `/* … *​/` work it already did, both preserve length and newlines exactly,
 * and `stripCLike` stays the same code the other twenty-odd formats are tested on.
 *
 * THE OTHER OBVIOUS ENTRY, `php: "hash"`, WAS BUILT AND PRICED TOO, because it is what a reader
 * reaches for first: it changes 55,444 of the 58,364 files, since `hash` strips no `//` and no
 * `/* … *​/` at all. Composition is what keeps both halves.
 *
 * FOUR PHP RULES DECIDE WHERE A `#` IS A COMMENT, and every one of them is a rule of the language
 * rather than a heuristic:
 *
 *   1. `#[` IS NOT A COMMENT. It is PHP 8's attribute token (`#[Attribute]`, `#[Route('/x')]`,
 *      `function f(#[SensitiveParameter] $p)`), an executed declaration. 1,269 of the corpus's
 *      58,364 `.php` files contain `#[`. Blanking them would delete code from a guard's view; the
 *      `#` of a `#[` is emitted verbatim and the rest is read as ordinary code, so a `#` LATER
 *      inside an attribute's arguments is still a comment, as PHP says it is.
 *   2. A `#` INSIDE A STRING IS NOT A COMMENT — `'#ffffff'`, `"user#$id"`, `"http://x/#frag"` — and
 *      PHP has four string forms, all four tracked here: `'…'`, `"…"`, `` `…` `` (shell-exec) and
 *      heredoc/nowdoc. An unterminated one runs to end of file rather than closing at the newline,
 *      because PHP strings legitimately span lines; that suppresses further `#` stripping in the
 *      file, which is the under-stripping direction.
 *   3. A `#` INSIDE A HEREDOC OR NOWDOC IS NOT A COMMENT. `<<<SQL … SQL;` and `<<<'SQL' … SQL;`
 *      carry SQL, Markdown, shell and HTML in this corpus, all of which write `#` as content.
 *      **`stripCLike` tracks no heredoc at all and still does not** — a heredoc body is read as
 *      code by the second half of this composition exactly as it was before, which is a real
 *      pre-existing defect, sized in an internal record and left there. What is
 *      fixed here is only that the FIRST half does not cut a `#` inside one.
 *   4. `?>` TERMINATES A `#` COMMENT, before the newline does. `# comment ?> back to HTML` ends at
 *      the `?>`; the `?>` and everything after it on that line are real again. This is the same rule
 *      for `//`, and `stripCLike` does NOT implement it: over the corpus that costs 6 lines / 33
 *      characters in 5 files, all of them WordPress-style templates writing
 *      `<?php …; // phpcs:ignore … ?> role="alert">`, where the `role="alert"` is blanked.
 *      Sized in an internal record, not fixed here. **25** corpus files have a
 *      line on which a `#` or `//` precedes a `?>`, but that is a TEXTUAL test: in only **5** of them
 *      — the same five — does one of this reader's own comments actually end at a `?>` and leave PHP
 *      mode, and in **0** files does the rule change the shipped output at all. Corrected 2026-08-13
 *      after an independent verification (D4); the sentence here used to say all 25 left PHP mode.
 *
 * A `#!` SHEBANG NEEDS NO SPECIAL CASE, and it does not have one. A `.php` file starts in HTML/text
 * mode and stays there until its first `<?php` or `<?=`, so a shebang on line 1 is outside PHP by
 * construction and is never a candidate. One corpus `.php` file starts with `#!`; it comes out
 * unchanged.
 *
 * THE REGION TRACKING IS FORCED BY RULE 4, NOT ADDED ALONGSIDE IT. Once `?>` has to end a comment,
 * the reader necessarily knows it is outside PHP afterwards, and text outside `<?php … ?>` is raw
 * HTML where `#` is `href="#top"` and `#header { … }` rather than a comment. Only `<?php` (followed
 * by whitespace) and `<?=` re-open PHP here. The short open tag `<?` is deliberately NOT recognised:
 * it is off by default in modern PHP, `<?xml` would collide with it, and refusing to recognise it
 * means those regions get no `#` stripping at all — the under-stripping direction. **7** corpus
 * files contain such a `<?` in their text, and in **0** of them would recognising it change this
 * file's output — measured by building a variant that does recognise it and diffing over all 58,364
 * files. So the decision costs nothing measurable today. Corrected 2026-08-13 after an independent
 * verification (D5); the sentence here used to leave the 7 to be read as an operational cost.
 *
 * WHAT THIS DOES NOT TOUCH, said plainly because a mode named after a language otherwise reads as
 * "this language is handled": `stripCLike` still reads the HTML regions of a `.php` file as code, so
 * a `//` or `/* … *​/` in raw HTML is still blanked. That is a SEPARATE defect with a separate cause,
 * it predates this entry, and it is measured and sized rather than fixed here — one engine change
 * per measurement. The size, identical before and after this change: **75 files,
 * 1,152 lines, 26,776 characters** blanked outside `<?php … ?>`. 1,031 of those lines are inside an
 * inline `<script>` or `<style>` body, where `//` and `/* … *​/` really are comments in JavaScript
 * and CSS and the answer is right for the wrong reason. All 121 remaining lines were read: 115 are
 * comments in another language (Blade `@php` bodies, a JS-emitting `.php`, a PHP-DI code template)
 * and **6 lines / 33 characters in 5 files are real HTML content**. It shuts 0 gates today.
 *
 * THE LARGER HALF OF THAT RESIDUE WAS FIXED BY A LATER COMMIT, NOT HERE. Before it the real-content
 * figure was 18 lines / 248 characters in 6 files, and 12 of those lines were one tree's WordPress
 * template in which the `/*` of `/app/*` written in prose opened a block comment with no `*​/`
 * anywhere after it, blanking to end of file. That commit made an unterminated `/*` emit verbatim and
 * those 12 lines came back — 260 non-blank characters in that file, now 0. What is left is entirely
 * the `//`-does-not-end-at-`?>` residue described under rule 4.
 */
function phpOpenTagEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const at = text.indexOf("<?", i);
    if (at === -1) return -1;
    if (text[at + 2] === "=") return at + 3;
    if (text.slice(at + 2, at + 5).toLowerCase() === "php") {
      const after = text[at + 5];
      if (after === undefined || after === " " || after === "\t" || after === "\n" || after === "\r") {
        return at + 5;
      }
    }
    i = at + 2;
  }
  return -1;
}

/**
 * The index just past the closing quote of the string starting at `start`, or the end of the text
 * when it is never closed. `\` escapes the next character, which finds the terminator correctly for
 * all three of PHP's inline string forms even though they differ in which escapes MEAN anything.
 */
function phpStringEnd(text: string, start: number): number {
  const q = text[start];
  let j = start + 1;
  while (j < text.length) {
    const ch = text[j];
    if (ch === "\\") { j += 2; continue; }
    if (ch === q) return j + 1;
    j++;
  }
  return text.length;
}

/** `<<<ID`, `<<<"ID"` and `<<<'ID'`, the opener having to end the line. */
const HEREDOC_OPEN = /^<<<[ \t]*(['"]?)([A-Za-z_\x80-\uFFFF][A-Za-z0-9_\x80-\uFFFF]*)\1\r?\n/;

/**
 * The index just past the closing label of the heredoc or nowdoc starting at `start`, or `-1` when
 * the `<<<` there does not open one at all.
 *
 * The closing label is recognised at the first non-blank position of a line, which is PHP 7.3's
 * indented-terminator rule, and only when the character after it cannot continue an identifier —
 * so a body line reading `SQLITE_BUSY` does not close a `<<<SQL`. An unterminated heredoc runs to
 * end of file, which suppresses `#` stripping for the rest of it: the under-stripping direction.
 *
 * THE OPENER IS MATCHED AGAINST THE REST OF ITS OWN LINE, NOT A FIXED WINDOW, and that is a fix
 * rather than a style: it was `text.slice(start, start + 256)` until 2026-08-13, so a heredoc whose
 * label ran past ~251 characters did not match `HEREDOC_OPEN` at all, the body was handed to the
 * code branch, and a `#` in it was blanked. That is the over-stripping direction and it was the only
 * one an independent verification could construct against this reader. No corpus file is of that shape, and that is
 * counted rather than assumed: the 94 pinned trees hold **626 heredoc openers** in `.php` files and
 * **the longest label is 10 characters** (`JAVASCRIPT`, in one PEAR QuickForm file);
 * 558 of the 626 are three characters. So the fix moves nothing that can be measured, and it is made
 * because a bound nobody can state is not a bound.
 */
function phpHeredocEnd(text: string, start: number): number {
  const lineEnd = text.indexOf("\n", start);
  const m = HEREDOC_OPEN.exec(text.slice(start, lineEnd === -1 ? text.length : lineEnd + 1));
  if (!m) return -1;
  const label = m[2];
  let j = start + m[0].length;
  while (j <= text.length) {
    let k = j;
    while (text[k] === " " || text[k] === "\t") k++;
    if (text.startsWith(label, k)) {
      const after = text[k + label.length];
      if (after === undefined || !isWordChar(after)) return k + label.length;
    }
    const nl = text.indexOf("\n", j);
    if (nl === -1) return text.length;
    j = nl + 1;
  }
  return text.length;
}

/**
 * Where a `#` or `//` comment ends: at the newline, or at a `?>` before it, whichever comes first.
 * The `?>` itself is NOT part of the comment — PHP is back to emitting HTML from there.
 */
function phpCommentEnd(text: string, start: number): number {
  let j = start;
  while (j < text.length) {
    if (text[j] === "\n") return j;
    if (text[j] === "?" && text[j + 1] === ">") return j;
    j++;
  }
  return text.length;
}

/**
 * Blanks `#` comments and NOTHING else. `//` and `/* … *​/` are recognised only so that a `#` inside
 * one is not cut — cutting there would delete the `*​/` of `/* fix #123 *​/ $x = 1;` and leave
 * `stripCLike` blanking the remainder of the file — and they are emitted verbatim for `stripCLike`
 * to handle as it always has.
 */
function stripPhpHash(text: string): string {
  let out = "";
  let i = 0;
  let inPhp = false;
  while (i < text.length) {
    if (!inPhp) {
      const open = phpOpenTagEnd(text, i);
      if (open === -1) { out += text.slice(i); break; }
      out += text.slice(i, open);
      i = open;
      inPhp = true;
      continue;
    }
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = phpStringEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "<" && text[i + 1] === "<" && text[i + 2] === "<") {
      const end = phpHeredocEnd(text, i);
      if (end !== -1) { out += text.slice(i, end); i = end; continue; }
    }
    if (ch === "/" && text[i + 1] === "*") {
      const at = text.indexOf("*/", i + 2);
      const end = at === -1 ? text.length : at + 2;
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const end = phpCommentEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "#") {
      // `#[` is PHP 8's attribute token, which is a declaration and not a comment.
      if (text[i + 1] === "[") { out += ch; i++; continue; }
      const end = phpCommentEnd(text, i);
      out += blank(text, i, end);
      i = end;
      continue;
    }
    if (ch === "?" && text[i + 1] === ">") { out += "?>"; i += 2; inPhp = false; continue; }
    out += ch;
    i++;
  }
  return out;
}

function stripPhp(text: string): string {
  // `true`: a PHP single-quoted string legally spans lines. See the note above `singleQuoteCloses`.
  return stripCLike(stripPhpHash(text), true, true);
}

/**
 * Where a `<script>` or `<style>` element opens at `i`, and where its body ends — or `null` when
 * the text at `i` does not open one.
 *
 * EXPORTED BECAUSE THIS IS THE ONE FACT TWO FILES HAVE TO AGREE ON, and until 2026-08-13 they did
 * not. A check has its own `stripMarkup`, which it MUST keep — its blanking emits
 * newlines only and deliberately does not preserve length, because it feeds an "is this mutant
 * identical to its base" comparison rather than a line-numbered guard. Two functions with different
 * postconditions are not a duplicated fact. But both of them also had to answer *"does a script or
 * style element open at this `<`, and how far does it run"*, and that question has exactly one right
 * answer. Kept as two copies, the copies diverged: mutation-check's carried a `/>` guard from the
 * start and this one did not, so a self-closing `<script … />` here opened a span that never closed
 * and blanked 9,926 characters of Markdown prose in one tree's `AGENTS.md`. That is
 * the project's rule, "never keep a second copy of anything two places must agree on", and this export is
 * the "export it and import it" half. `syntaxFor` below is exported for the same reason and set the
 * precedent.
 *
 * The paragraphs below were written for `stripMarkup` and are MOVED here rather than rewritten,
 * because every one of them is about this test rather than about the stripping around it.
 *
 * A `<script>` or `<style>` IMMEDIATELY PRECEDED BY A BACKTICK IS NOT AN ELEMENT. In Markdown and
 * MDX — which are 54,845 of the 82,466 files this mode reads across the 94 pinned corpus trees —
 * a backtick opens an inline code span, so `` `<script>` `` in prose is a tag being *written about*
 * rather than a tag being opened. Without this test the reader delegates everything from that
 * mention to the next `</script>` anywhere in the file to `stripCLike`, which then reads Markdown
 * prose as JavaScript.
 *
 * MEASURED, on 2026-08-13, as work item #47.
 * One real tree's `CHANGELOG.md` has EIGHT such spans, six of them opened by a backticked
 * mention, the longest running 2,996 lines. After `stripCLike` gained regex-literal state on
 * 2026-08-13 the quote parity inside one of those bogus spans shifted by one, so at line 10828 the
 * `/*` of `"include": [".astro/types.d.ts", "**\/*"]` was read as a block comment and blanked 1,853
 * characters of release notes. **109 lines / 6,835 characters of real Markdown content were blanked
 * that the pre-fix engine left standing** — over-stripping, which the header of this file calls the
 * dangerous direction, and the only instance of it found anywhere in the `markup`, `css` or `hcl`
 * paths.
 *
 * The test is on the character before the tag rather than on Markdown fence tracking, because that
 * is what the measurement supports. Over all 90,569 `markup` + `css` + `hcl` files: 37 files change,
 * every one of them `.md` or `.mdx`, **74,450 characters of real content stop being blanked** and
 * the 2,685 characters that start being blanked are **comments without exception** — 71 lines, every
 * one an `<!-- … -->` or a `//`, each read.
 *
 * SKIPPING AN OPENER IS NOT A ONE-WAY SAFE OPERATION, and an earlier version of this comment said it
 * was. Skipped text returns to the caller's own loop, which has a branch `stripCLike` does not:
 * `<!--`. An `<!--` with no `-->` blanks to end of file. So the skip can newly blank as well as
 * newly keep, and the 2,685 characters above ARE that mechanism — a `<!-- … -->` in Markdown prose
 * that the delegated reader could not see. **Measured on 2026-08-13 (work item #51): 7 markup files
 * in the corpus carry an unterminated `<!--`, and in 0 of them do these guards route any text into
 * one.** The hazard is latent, not live, and it is written down rather than denied.
 *
 * SELF-CLOSING TAGS, added 2026-08-13. `<script … />` and `<style … />` have no closing tag, so
 * `closeIdx` is -1 and the span runs to end of file. A check's own copy of this
 * logic had the guard and this one did not, which is the two-copies-disagreeing failure. Measured
 * over all 82,466 `markup` files: **21 files carry 28 such openers, 17 of them running to end of
 * file**, and adding the guard changes 4 files — **11,426 characters over 255 lines stop being
 * blanked, 217 of those lines real content**, and 612 characters over 11 lines start being blanked,
 * **every one of the 11 a genuine `<!-- … -->` XML comment** in an Android `themes.xml` that the
 * runaway span had been hiding. The worst single case was
 * one tree's `AGENTS.md`, where
 * `<script {...pageProps(data)} />` blanked **9,926 characters over 217 lines, 207 of them
 * Markdown prose** — larger than the 6,835-character over-strip the backtick test above exists to
 * remove. Most of the 28 are inert because the tag sits on the last line of its file.
 *
 * WHAT NEITHER TEST CATCHES, named because an unnamed gap is one nobody sizes.
 *
 *   - **A padded code span.** `` ` <script> ` `` puts a space between the backtick and the tag, so
 *     `text[i - 1]` is not a backtick and the span opens. **38 openers in 26 corpus files.** An
 *     escaped backtick (`` \`<script>``) is likewise uncaught; **0 corpus files**.
 *   - **A `>` inside an attribute value.** The opener pattern is `[^>]*>`, so it stops at the first
 *     `>`; `<script data-x="a/>b">` is read as self-closing and skipped. The error direction is a
 *     skip, which under-strips, and no corpus file exhibits it.
 *   - **A genuine element preceded by a backtick, in ANY markup format.** `.html` and `.xml` have no
 *     code-span construct, and `.vue`, `.svelte`, `.astro`, `.hbs`, `.mustache`, `.twig` and `.erb`
 *     all carry JavaScript template literals in which a backtick before a `<` is ordinary text.
 *     Skipping there leaves that script's comments unstripped, which is this file's stated
 *     conservative direction. **0 files of any of those formats change in the corpus.**
 *   - **A `<script>` at the start of a line INSIDE a fenced code block.** CLOSED ON 2026-08-13 FOR
 *     MARKDOWN ONLY, and not here: `fencedCodeRegions` holds those spans out of the reader's reach
 *     before this function is ever asked.
 *     Across all 82,466 `markup` files the spans this function opens fall from **28,639 to 23,867**
 *     and spans running to end of file from **45 to 26**; among Markdown files alone, from 4,946
 *     spans to 174, spans over 50 lines from 79 in 64 files to 27 in 27 files, and to-EOF spans from
 *     44 to 25. **Not one of the remaining 26 is inside a fenced code block** — not under this rule
 *     and not under an any-indent one — so no fence rule can reach them. Each was located and read:
 *     **21 sit inside an INLINE code span this function's one-character backtick test cannot see**,
 *     because the tag is padded from the backtick or preceded by an escape or a path
 *     (`` `\<style>` `` in one tree's docs, `` `npm run <script> --workspace=…` `` in another's,
 *     ```` ```…/migrations/<script-name>.ts``` ```` in a third's), and five of the 21 are metavariable
 *     placeholders that only match this pattern because `\b` sits happily before `-` and `:`
 *     (`<script-name>`, `<script:string>`, `<style = blue>`); **3 are genuine one-line HTML** in
 *     one tree's sanitiser test inputs; **1 is a plain prose mention** of a
 *     `<script>` tag in a changelog); and **1 is not Markdown at all** — a `-#`
 *     HAML comment in one tree that mentions a `<style>` tag. That is a different defect with a
 *     different fix, in this function rather than in the fence reader; open item O14.
 *
 * A `<style>` CARRYING A `name` ATTRIBUTE IS NOT CSS, added 2026-08-13.
 * **In an Android resource file `<style name="…">` is a
 * THEME**, its body is `<item>` elements, and its comments are `<!-- … -->`. This function opened a
 * CSS span there, which had two consequences in opposite directions: the body's `<!-- … -->` XML
 * comments were NOT blanked, because the markup loop's comment branch does not run inside a
 * delegated body — a comment reaching a corroboration gate as if it were code, which is the exact
 * asymmetry the header of this file records; and any `/* … *​/` in the body WOULD have been blanked
 * as a CSS comment, which in XML is content.
 *
 * The `/>` guard above does not reach this. A theme `<style name="…">` with `<item>` children has a
 * real closing tag, so it was never self-closing. The two populations overlap and are not the same
 * one: of the **21** files carrying a self-closing opener, **9** are Android `themes.xml` files under
 * a `res/values` directory, and only **4** of those also carry a non-self-closing `<style name="…">`.
 *
 * THE CENSUS, over all 82,466 `markup` files the walker returns across the 94 pinned corpus trees.
 * **5,858 `<style>` elements in 5,141 files; 69 of them carry a `name` attribute, in 32 files.** All
 * 69 are Android themes: 68 are in `.xml` files whose root element is `<resources>` and whose path
 * contains `res/values`, and the 69th is the identical snippet quoted inside a Markdown tutorial
 * (one tree's Android tutorial). **All 69 have `<item>` children, and 0
 * `<style>` element in any `.xml` file lacks a `name` attribute** — so on this corpus the attribute,
 * the root element, the extension and the body's shape all name the same 69 elements.
 *
 * MEASURED BOTH WAYS over all 82,466 files: **18 files change, 45 lines are newly BLANKED (1,758
 * characters), 0 lines are newly kept, and 0 line moves in both directions.** All 45 were printed and
 * read: every one is inside a genuine `<!-- … -->` XML comment (41 carry an `<!--` or `-->` on the
 * line itself; the other 4 are the MIDDLE line of a three-line comment, the same
 * documentation URL twice each in two Android
 * theme files).
 * **0 characters of content are lost.** **0 gate results flip and 0 locations move** across 162
 * (rule, file) pairs, and the positive control is not the usual one: RAW against FULLY BLANKED moves
 * **0** pairs on these 18 files, so that control is blind here and says nothing. The control that
 * works is the one an internal record used — **126 of the 144 shut pairs
 * open when their own rule's `bad` fixtures are appended, and the remaining 18 (all
 * `eu-consent-021`, whose clause needs consent vocabulary PRESENT and refusal vocabulary ABSENT, so
 * its own bad fixtures can only keep it shut) open on a targeted spike. 144 of 144.** The other 18
 * pairs are `eu-data-act-001`, open in every state through its negative-lookahead clause.
 *
 * WHY THE ATTRIBUTE AND NOT THE OTHER THREE OBSERVABLES, and the corpus cannot answer it: all four
 * candidate designs — refuse on `name=`, refuse when the root element is `<resources>`, refuse every
 * `<style>` in a `.xml`, refuse when the body holds `<item>` children — were built and compared
 * character by character over all 82,466 files, and **0 files disagree**. The separation is from
 * constructed inputs instead:
 *
 *   - **The root-element test misses a theme quoted in prose** (the 69th) **and a theme in a document
 *     whose root is not `<resources>`**, and it rescans from offset 0 at every opener.
 *   - **The extension test is wrong about XML itself.** `.xml` legitimately carries CSS — SVG's
 *     `<style>` and XHTML's — and refusing there leaves real CSS comments standing in front of a
 *     gate. It also needs the FILE NAME, which this function does not receive, so it means widening
 *     the exported signature that a check imports; a caller that did not pass the
 *     new argument would silently get the old behaviour, which is the two-copies-disagreeing failure
 *     work item #54 removed, in a new shape.
 *   - **The body-shape test is wrong in both directions.** A theme with no `<item>` children is read
 *     as CSS, and an ordinary CSS body writing `content: "<item>"` is refused. It also scans a body
 *     that may run to end of file.
 *   - **The attribute test is local, is bounded by the 200-character opener window already sliced,
 *     and is right about the formats.** No `<style>` in HTML, Vue, Svelte or Astro takes a `name`
 *     attribute — Vue's module syntax is `module="…"`, and `data-name="…"` does not match, because
 *     the test requires whitespace before `name` and `=` after it. **0 `<script>` elements in the
 *     corpus carry a `name` attribute**, so restricting the refusal to `<style>` is unobservable
 *     here and is done because it is what the semantics say.
 *
 * WHAT REFUSING COSTS, named because refusing is not a one-way safe operation. The body returns to
 * the markup loop, which has a branch `stripCLike` does not: an **unterminated `<!--` blanks to end
 * of file**. That is demonstrated on a constructed input rather than denied. **0 of the 69 bodies
 * carry more `<!--` than `-->`**, and **0 contain a `/*` at all** — which is why the newly-kept
 * column is zero rather than merely small. The hazard is latent, sized and written down.
 *
 * THREE MORE PROPERTIES, WRITTEN DOWN BECAUSE EXPORTING THIS IMPOSES THEM ON A SECOND CALLER.
 * A check's own copy answered all three differently, and each was measured on
 * 2026-08-13 BEFORE the copy was
 * replaced by this function, so that adopting them is a priced decision and not an accident. None
 * of the three is changed here: this export reproduces the shipped behaviour exactly, so that
 * `contentForGuards` output is byte-identical across the change and G1/G2 cannot move. Correcting
 * any of them is a separate work item with its own corpus measurement.
 *
 *   - **THE 200-CHARACTER WINDOW.** The opener is matched against `text.slice(i, i + 200)`, so an
 *     opening tag whose `>` is further away than that is not recognised as an element at all and its
 *     body is never delegated. That is the under-stripping direction. **24 openers in 12 corpus
 *     markup files** are past the window — the widest is 4,895 characters, in
 *     one tree's `CHANGELOG.md` — and they are real: another tree's
 *     signup-form pages carry six openers each with long inline attribute lists. The window is not
 *     cosmetic; it is what stops the opener test slicing the remainder of the file at every
 *     character position.
 *   - **THE CLOSING TAG IS MATCHED LITERALLY**, as `</script>` or `</style>`, case-insensitively but
 *     with no tolerance for the whitespace HTML5 permits before the `>`. So `</script >` does not
 *     close the element and the body runs on to the next literal close or to end of file.
 *     mutation-check's copy used `/<\/script\s*>/i` and did close there. **0 occurrences of the lax
 *     spelling in all 82,419 corpus markup files**, so the difference is unobservable today.
 *   - **`text.toLowerCase()` IS NOT LENGTH-PRESERVING**, and the close search takes its index from a
 *     lowercased copy while using it against the original. `U+0130` (`İ`, Turkish dotted capital I)
 *     lowercases to two code units, so each one before the closing tag shifts `bodyEnd` one
 *     character late. **203 corpus markup files hold such a character; 2 of them also hold a
 *     script/style tag; in exactly 1, a localised error page, the span moves, by one
 *     character.** It is a genuine off-by-one and it is inert there: the character it swallows is the
 *     `<` of `</script>`, `stripCLike` emits it unchanged, and the markup loop's only other branch
 *     needs a `<!--`. Recorded rather than fixed, because a fix is an engine behaviour change and
 *     this work item is a de-duplication.
 */
export interface MarkupElement {
  /** Lowercased tag name. It is what decides whether the body is JavaScript or CSS. */
  readonly name: "script" | "style";
  /** Index just past the `>` of the opening tag — where the body starts. */
  readonly bodyStart: number;
  /** Index of the `<` of the closing tag, or `text.length` when the element is never closed. */
  readonly bodyEnd: number;
}

export function markupElementAt(text: string, i: number): MarkupElement | null {
  // Semantically redundant — the pattern below is anchored on `<` — and kept because without it
  // every character position of every markup file allocates a 200-character slice.
  if (text[i] !== "<") return null;
  const open = /^<(script|style)\b[^>]*>/i.exec(text.slice(i, i + 200));
  if (!open || text[i - 1] === "`" || open[0].endsWith("/>")) return null;
  const name = open[1].toLowerCase() as "script" | "style";
  // An Android theme, not a CSS element: `<style name="Theme.X" parent="Y">` holds `<item>` children
  // and comments in `<!-- … -->`. See the note above. The whitespace before `name` and the `=` after
  // it are both load-bearing — without them `data-name="x"` and a `namespace` attribute would match.
  if (name === "style" && /\sname\s*=/i.test(open[0])) return null;
  const bodyStart = i + open[0].length;
  const closeIdx = text.toLowerCase().indexOf(`</${name}>`, bodyStart);
  return { name, bodyStart, bodyEnd: closeIdx === -1 ? text.length : closeIdx };
}

/** A half-open `[start, end)` span of the text that the markup reader must copy out verbatim. */
interface OpaqueRegion {
  readonly start: number;
  readonly end: number;
}

/**
 * A FENCED CODE BLOCK IS QUOTED TEXT, NOT MARKUP, and until 2026-08-13 this file had no idea.
 *
 * CommonMark §4.5: three or more backticks or tildes at the start of a line open a fenced code
 * block whose content is LITERAL TEXT. A `<script>` written inside one is a tag being shown to the
 * reader, exactly as a backticked `` `<script>` `` in prose is — and the backtick guard in
 * `markupElementAt` closes only the inline form. Without this, the reader opened an element at a
 * sample's `<script>` and handed the rest of the document to `stripCLike` until the next
 * `</script>` or end of file.
 *
 * WHAT THIS IS FOR, IN ONE NUMBER, AND IT IS TARGET-CORRECTNESS AND NOT PRECISION. Over the 54,845
 * Markdown-family files in the 94 pinned corpus trees there are **37,229 `//`-comment-shaped lines
 * inside fenced code blocks, and the reader blanked 588 of them — 1.6 %**. The 588 are not a policy;
 * they are the samples in which an HTML tag happened to be in scope. A rule that blanks 1.6 % of one
 * population is not under-inclusive, it is wrong about what it is looking at.
 *
 * WHAT IS RECOGNISED, and every clause is CommonMark's rather than a shortcut, with the corpus
 * count for each over 146,908 fenced blocks in 30,685 files:
 *
 *   - **Three or more backticks (146,886) or tildes (22)**, and a longer opener needs a closer at
 *     least as long — 72 openers are four markers or more, and 98 blocks are closed by a fence
 *     LONGER than their opener.
 *   - **An info string** after the opener (` ```html `): 140,993 blocks carry one. A BACKTICK inside
 *     a backtick opener's info string means it is not a fence at all, which is CommonMark's rule and
 *     is what keeps `` ``` `<script>` ``` `` in prose from opening a block.
 *   - **An opener indented up to three spaces** (6,755 blocks), with the CLOSING fence allowed a
 *     different indent of its own (183 blocks).
 *   - **A closing fence carries no info string**, so ` ``` js ` does not close.
 *   - **An unterminated fence runs to end of file** (33 blocks), which is CommonMark's rule and is
 *     also the safe direction here: the remainder of the document is read as quoted text rather than
 *     as markup.
 *
 * WHAT IS NOT RECOGNISED, named and sized because an unnamed gap is one nobody prices:
 *
 *   - **A FENCE INDENTED FOUR SPACES OR MORE**, which inside a list item is a fence indented to the
 *     list's content column and at top level is an indented code block. Both are quoted text and
 *     this reader sees neither. A variant recognising a fence at ANY indent was built and measured:
 *     it changes **4 more files** (654 more characters kept, 0 newly blanked) and closes **no
 *     further runaway span**. It is not adopted because its CLOSING rule is what changes with it —
 *     an indented ``` inside a block would end that block early, which is the newly-blanking
 *     direction, and no corpus file exercises it either way. Sized, not fixed; open item O13.
 *   - **AN INDENTED CODE BLOCK** (four spaces, no fence at all). Recognising one needs block context
 *     — a blank line before it, and it must not be list-item content — and a variant carrying that
 *     heuristic was built too: **3 more files, 0 newly blanked**, and every one of the three is a
 *     list-item fence the variant above already reaches. Not adopted for the size of the heuristic
 *     against the size of the effect. O13.
 *   - **A FENCE INSIDE AN HTML BLOCK.** CommonMark says a ``` line directly under an open `<div>`
 *     with no blank line between is raw HTML, not a fence; this reader calls it a fence. **3
 *     occurrences in 2 corpus files.** The direction is over-suppression, which under-strips.
 *   - **Anything that needs the document's block structure**: block quotes, nested containers, and
 *     lazy continuation. This is a line scanner, not a Markdown parser.
 *
 * MEASURED BOTH WAYS over all 82,466 `markup` files: **487 files change — 431 `.md` and 56 `.mdx` —
 * 2,322 lines / 73,427 characters are newly KEPT, and 0 lines / 0 characters are newly BLANKED**.
 * Every one of the 2,322 was classified by reading the line: 1,109 `<!-- … -->`, 590 `//`, 316
 * `/* … *​/`, 128 trailing `//`, and **179 lines that are not comment-shaped at all — real
 * documentation content, every one of them read individually**: sample HTML in one tree's
 * challenges, Angular template structure in another, SPDX headers in a quoted licence block,
 * and test assertions in a third's CHANGELOGs.
 *
 * **A pass that only stops blanking cannot hide code**, so this change has one direction. What it
 * gives up is stated plainly: a comment inside a code sample now reaches the corroboration gates as
 * text. That is the under-stripping direction this file's header accepts, and it is what the
 * measurement above prices — **0 gate results flip and 0 locations move** across 2,364 (rule, file)
 * pairs, with a control that is shown not to be blind.
 *
 * ONE POLICY REALLY DOES CHANGE, AND IT IS NOT A CONSISTENCY FIX: `<!-- … -->` INSIDE A FENCE. The
 * reader blanked **1,137 of the 1,146** such spans and now blanks none, because a fence's content is
 * literal text and an `<!-- … -->` in one is displayed rather than a comment. The alternative — keep
 * the comment branch running inside fences and suppress only the element branch — was built and
 * measured: it recovers less than half as much (238 files, 1,066 lines) and it **newly blanks 6
 * lines**, every one of them a `<!-- … -->` written inside a documentation sample
 * (`<!-- part of <template> -->`, `<!-- or -->`), which is real page text.
 */
const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;
const FENCE_CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/;

function fencedCodeRegions(text: string): OpaqueRegion[] {
  const regions: OpaqueRegion[] = [];
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  // The line WITHOUT its newline. `[^\n]*` rather than `.*` in the patterns above is load-bearing
  // and was found by an instrument that got it wrong: `.` does not match `\r`, so a `.*`-spelled
  // opener fails on every CRLF file, and 53 corpus blocks are in such files.
  const endOf = (k: number) => (k + 1 < starts.length ? starts[k + 1] - 1 : text.length);
  let k = 0;
  while (k < starts.length) {
    const open = FENCE_OPENER.exec(text.slice(starts[k], endOf(k)));
    // A backtick inside a backtick fence's info string means this is not a fence (CommonMark §4.5).
    if (!open || (open[1][0] === "`" && open[2].includes("`"))) {
      k++;
      continue;
    }
    const marker = open[1];
    let j = k + 1;
    let end = text.length;
    for (; j < starts.length; j++) {
      const close = FENCE_CLOSER.exec(text.slice(starts[j], endOf(j)));
      if (close && close[1][0] === marker[0] && close[1].length >= marker.length) {
        end = endOf(j);
        break;
      }
    }
    regions.push({ start: starts[k], end });
    // An unterminated fence consumed the rest of the file, so there is nothing after it to scan.
    k = j >= starts.length ? starts.length : j + 1;
  }
  return regions;
}

/**
 * `<!-- … -->`, plus C-like comments inside `<script>` and `<style>` blocks.
 *
 * Where an element opens and how far it runs is `markupElementAt`'s answer, not this function's:
 * a check asks the same function, so the two cannot drift again. What stays here
 * is what this stripper does with the answer — blank with spaces, preserve length exactly — which is
 * the postcondition mutation-check's stripper deliberately does NOT share.
 *
 * `opaque` is the sorted, disjoint list of spans this reader must not look inside — Markdown's
 * fenced code blocks, and nothing else today. It is EMPTY for every other markup format, so those
 * 19 extensions run exactly the loop they always did. A span is emitted verbatim, which is why the
 * postcondition still holds: every branch of this loop emits as many characters as it consumes.
 *
 * A REGION IS ONLY CONSULTED AT THE TOP OF THE LOOP, so an element body or an `<!-- … -->` span that
 * begins OUTSIDE a fence may still run over one. That is deliberate — a ``` inside a real `<script>`
 * body is a JavaScript template literal and not a fence — and it is what makes the two branches
 * below unchanged rather than region-aware.
 */
function stripMarkup(text: string, opaque: readonly OpaqueRegion[] = []): string {
  let out = "";
  let i = 0;
  let r = 0;
  while (i < text.length) {
    while (r < opaque.length && opaque[r].end <= i) r++;
    if (r < opaque.length && i >= opaque[r].start) {
      out += text.slice(i, opaque[r].end);
      i = opaque[r].end;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      const j = end === -1 ? text.length : end + 3;
      out += blank(text, i, j);
      i = j;
      continue;
    }
    const el = markupElementAt(text, i);
    if (el) {
      out += text.slice(i, el.bodyStart);
      out += stripCLike(text.slice(el.bodyStart, el.bodyEnd), el.name !== "style");
      i = el.bodyEnd;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * Markdown, MDX and `.markdown`: the markup reader with the file's fenced code blocks held out of
 * its reach. Composed rather than rewritten, exactly as `stripHcl` and `stripPhp` are composed and
 * for the same stated reason — each half stays the code the rest of this file is tested on, and
 * neither half can shift a line number.
 */
function stripMarkdown(text: string): string {
  return stripMarkup(text, fencedCodeRegions(text));
}

/**
 * A comment marker: a literal, or a sticky pattern for a form that carries optional whitespace and
 * trim markers (Liquid's `{%- comment -%}`). Sticky, so it can only match AT the offset asked about
 * and never somewhere further down the file.
 */
type Marker = string | RegExp;

/** The length of the marker at `i`, or -1 when it is not there. */
function markerAt(text: string, i: number, marker: Marker): number {
  if (typeof marker === "string") return text.startsWith(marker, i) ? marker.length : -1;
  marker.lastIndex = i;
  const m = marker.exec(text);
  return m ? m[0].length : -1;
}

/** The first position at or after `from` where `marker` occurs, with its length. */
function findMarker(text: string, from: number, marker: Marker): { index: number; length: number } | null {
  if (typeof marker === "string") {
    const at = text.indexOf(marker, from);
    return at === -1 ? null : { index: at, length: marker.length };
  }
  for (let j = from; j < text.length; j++) {
    const length = markerAt(text, j, marker);
    if (length >= 0) return { index: j, length };
  }
  return null;
}

/**
 * Blank every `[open … close]` span, keeping length and newlines exactly.
 *
 * Run as a PRE-PASS before the mode this composes with, so that `stripMarkup` and `stripPhp` are
 * left exactly the code the twenty-odd formats already on them are tested on. Markers are tried in
 * the order given, so a longer form is listed first (`{{!--` before `{{!`) or the shorter one eats
 * its opener. An unterminated open runs to end of file, which is what `<!--` already does in
 * `stripMarkup` — and, as there, it is the over-stripping direction, so it is bounded by being
 * measured rather than by a rule.
 *
 * A check carries a function of the same name and shape. THE TWO ARE NOT A
 * DUPLICATED FACT and they may not be merged: that one emits newlines ONLY and deliberately does not
 * preserve length, because it feeds an "is this mutant identical to its base" comparison rather than
 * a line-numbered guard — the same split `stripMarkup` and `markupElementAt` already carry, and the
 * same reason. What the two must agree on is WHICH MARKERS ARE A COMMENT, and that is the exported
 * TEMPLATE_COMMENTS table below, which mutation-check imports.
 */
function stripDelimited(text: string, blocks: readonly (readonly [Marker, Marker])[]): string {
  let out = "";
  let i = 0;
  scan: while (i < text.length) {
    for (const [open, close] of blocks) {
      const openLength = markerAt(text, i, open);
      if (openLength < 0) continue;
      const end = findMarker(text, i + openLength, close);
      const stop = end ? end.index + end.length : text.length;
      out += blank(text, i, stop);
      i = stop;
      continue scan;
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * Blank each line whose first non-blank characters are one of `markers`, from the marker to the end
 * of that line. The indentation is kept, so an indentation-sensitive language's structure survives
 * for anything reading the view as lines.
 *
 * Only the marker's OWN line. HAML, Slim and Pug all silence the more-indented block beneath a
 * comment as well, and that is not implemented — leaving those lines standing is the under-stripping
 * direction this file's header accepts, and it is the same call a check made.
 */
function stripLineStart(text: string, markers: readonly string[]): string {
  return text
    .split("\n")
    .map((line) => {
      let i = 0;
      while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
      for (const m of markers) {
        if (line.startsWith(m, i)) return line.slice(0, i) + " ".repeat(line.length - i);
      }
      return line;
    })
    .join("\n");
}

const LIQUID_COMMENT_OPEN = /\{%-?\s*comment\s*-?%\}/y;
const LIQUID_COMMENT_CLOSE = /\{%-?\s*endcomment\s*-?%\}/y;

/**
 * WHICH MARKERS ARE A COMMENT, in one place, for the two files that must agree about it.
 *
 * Exported for a check, which drives its own length-not-preserving blanker from
 * this table rather than keeping a second copy of the answer — the same arrangement `syntaxFor` and
 * `markupElementAt` already have, and the project's rule, "never keep a second copy of anything two places
 * must agree on — export it and import it".
 *
 * `blocks` are delimited comments. `lineStart` are markers that comment out the remainder of their
 * own line when they are its first non-blank token.
 *
 * THIS IS A CATALOGUE OF MARKERS, NOT THE LIST OF MODES THIS ENGINE RUNS. It carries eight entries
 * and `BY_EXT` maps only five of them — `liquid`, `slim` and `pug` were removed from the engine's
 * comment view on 2026-08-19, on a re-derived count of ZERO corpus occurrences each
 * (the reasoning is above `BY_EXT`). Their marker lists stay HERE because
 * a check still classifies those three extensions and has since 2026-08-11, for
 * a different question: whether a MUTANT perturbs anything. That table is deliberately a superset of
 * this engine's — it says so itself, about `txt` and `pug` — and deleting the markers would either
 * break it or push it back to keeping its own copy, which is the thing this export exists to stop.
 *
 * So: an entry here means "this is the comment syntax of that language". Whether the engine's
 * comment view USES it is `BY_EXT`'s question and only `BY_EXT`'s.
 */
export const TEMPLATE_COMMENTS: Record<
  "blade" | "twig" | "handlebars" | "erb-template" | "liquid" | "haml" | "slim" | "pug",
  { blocks: readonly (readonly [Marker, Marker])[]; lineStart: readonly string[] }
> = {
  blade: { blocks: [["{{--", "--}}"]], lineStart: [] },
  twig: { blocks: [["{#", "#}"]], lineStart: [] },
  // `{{!--` FIRST: `{{!` is a prefix of it, and trying the shorter one first would close the comment
  // at the `}}` of `--}}`'s neighbour and leave the tail of every long-form comment standing.
  handlebars: { blocks: [["{{!--", "--}}"], ["{{!", "}}"]], lineStart: [] },
  // ERB, EJS and EEx all write `<%# … %>`. `.heex` is NOT on this mode; see the table above.
  "erb-template": { blocks: [["<%#", "%>"]], lineStart: [] },
  // HAML has no delimited comment. `-#` is silent and `/` renders an HTML comment; both are comments
  // as the first token of a line, and neither is anything else there.
  haml: { blocks: [], lineStart: ["-#", "/"] },
  // The three below are NOT engine modes — see the note above. They are here for
  // a check, which classifies `.liquid`, `.slim` and `.pug` for the mutation
  // perturbation check.
  liquid: { blocks: [[LIQUID_COMMENT_OPEN, LIQUID_COMMENT_CLOSE]], lineStart: [] },
  slim: { blocks: [], lineStart: ["/"] },
  // Pug's `//-` is silent and `//` renders. `//-` first, for `{{!--`'s reason.
  pug: { blocks: [], lineStart: ["//-", "//"] },
};

/** The subset of TEMPLATE_COMMENTS this engine's comment view actually runs. */
type TemplateMode = "blade" | "twig" | "handlebars" | "erb-template" | "haml";
const ENGINE_TEMPLATE_MODES = new Set<string>(["blade", "twig", "handlebars", "erb-template", "haml"]);

/** A template mode: its own comment form blanked first, then the host format's reader. */
function stripTemplate(text: string, mode: TemplateMode): string {
  const { blocks, lineStart } = TEMPLATE_COMMENTS[mode];
  let out = text;
  if (blocks.length > 0) out = stripDelimited(out, blocks);
  if (lineStart.length > 0) out = stripLineStart(out, lineStart);
  // Blade's host is PHP, because a `.blade.php` file legitimately carries `<?php … ?>` and
  // `@php … @endphp` blocks whose comments `stripPhp` already reads. THE ORDER IS BLADE'S OWN, not a
  // convenience: Blade removes `{{-- … --}}` before it compiles anything, so a `<?php`, an `@php` or
  // a quote written inside a comment is not code, and running the comment pass FIRST is what says so.
  // The cost of that order is stated rather than hidden: a `{{--` inside a PHP string literal in a
  // Blade file would be blanked as a comment. A check takes the same order for the
  // same reason.
  //
  // The `pug` branch that used to stand here — `if (mode === "pug") return out;`, a mode with no
  // host reader at all — went with the mode on 2026-08-19. Every remaining template mode is markup
  // plus its own form, except Blade, which is PHP plus its own form.
  if (mode === "blade") return stripPhp(out);
  return stripMarkup(out);
}

/**
 * Which comment syntax this file has, or `null` for "this repository has not said".
 *
 * Exported so that a check can ask the question rather than keep a second copy
 * of the answer. `null` and `"none"` are DIFFERENT and the distinction is the whole point of the
 * check: `"none"` is a decision that the format has no comments, `null` is nobody having looked.
 * Reading them as the same thing is how `.sql`, `.tf` and `.env` each stayed unclassified while
 * every gate stayed green.
 */
export function syntaxFor(fileName: string): Syntax | null {
  const slash = fileName.lastIndexOf("/");
  const base = slash >= 0 ? fileName.slice(slash + 1) : fileName;
  const lower = fileName.toLowerCase();
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  // A name whose meaning lives in TWO segments is not read as the last one alone. Checked FIRST,
  // because `x.blade.php` also ends in `.php` and the single-extension table would answer `php`.
  // See the note above BY_COMPOUND_EXT.
  const lowerBase = base.toLowerCase();
  for (const [compound, syntax] of BY_COMPOUND_EXT) {
    if (lowerBase.endsWith(`.${compound}`)) return syntax;
  }
  // The extension table decides wherever it can key on the name. The two name tests are the
  // fallback for names it cannot key on — `.env`, `.env.local`, `api/.env.example`, `env.sample`,
  // `Dockerfile`, `Makefile` — and never an override of a name it can. Ordering this the other way
  // is what shipped on 2026-08-12 and read `src/env.ts` as dotenv; see the note above DOTENV.
  const known = BY_EXT[ext];
  if (known) return known;
  // A generic template suffix is not a format: ask again about the name underneath it. See the note
  // above GENERIC_TEMPLATE_SUFFIX for why `.eex` is resolved this way instead of getting a row in
  // the table above, and for what that leaves unstripped.
  if (GENERIC_TEMPLATE_SUFFIX.has(ext) && base.length > ext.length + 1) {
    return syntaxFor(fileName.slice(0, -(ext.length + 1)));
  }
  const byName = BY_BASENAME[base.toLowerCase()];
  if (byName) return byName;
  if (DOTENV.test(lower) || DOTENV_TEMPLATE.test(lower)) return "dotenv";
  return null;
}

/**
 * File content with comments blanked out.
 *
 * THE NAME IS NOW NARROWER THAN THE USE, and that is stated rather than left to be read off the
 * call sites. Until 2026-08-19 this view was for guard and corroboration evaluation ONLY, and the
 * sentence here read: *"The `match` side keeps using raw content: a rule may legitimately want to
 * match a comment, and each rule's own `match_without` already carries a comment-line clause where
 * that matters."* Both halves of that were measured false. `engine.ts` now tests `match` against
 * this view as well as against the raw line — see the note above its line loop for the two
 * measurements that decided it, and for the per-rule `match_in_comments` opt-in that gives the
 * original sentence back to the rules that really do want a comment.
 */
export function contentForGuards(fileName: string, content: string): string {
  return commentView(fileName, content).view;
}

/** `contentForGuards`'s view, with what the kind reading (above, "EACH FILE KIND'S OWN COMMENT RULE") cost. */
export interface CommentView {
  readonly view: string;
  /** Milliseconds the kind reading took (0 for a mode without one); not charged to the file's budget. */
  readonly kindReadingMs: number;
  /** The kind reading passed its allowance and the view is the family reading (KIND_READING_ALLOWANCE_MS). */
  readonly kindReadingStopped: boolean;
}

/**
 * The comment view and the cost of its kind reading (E5). For a kind with
 * its own reader the family reading is the fallback: the reading the kind had before 2026-11-11, used
 * whole when the kind reading passes `allowanceMs`.
 */
export function commentView(fileName: string, content: string, allowanceMs: number = KIND_READING_ALLOWANCE_MS): CommentView {
  const syntax = syntaxFor(fileName);
  if (syntax === null || syntax === "none") return { view: content, kindReadingMs: 0, kindReadingStopped: false };
  const kind = KIND_CUTS[syntax];
  if (!kind && syntax !== "ruby" && syntax !== "hcl" && syntax !== "hjson") {
    return { view: familyView(syntax, content), kindReadingMs: 0, kindReadingStopped: false };
  }
  const startedAt = performance.now();
  kindReadingStopsAt = startedAt + allowanceMs;
  try {
    const view =
      syntax === "ruby" ? stripRuby(content)
      : syntax === "hcl" ? stripHclKind(content)
      : syntax === "hjson" ? stripHjson(content)
      : stripByKind(content, kind!.family, kind!.cuts);
    return { view, kindReadingMs: performance.now() - startedAt, kindReadingStopped: false };
  } catch (e) {
    if (e !== KIND_READING_STOPPED) throw e;
    const kindReadingMs = performance.now() - startedAt;
    const view =
      syntax === "ruby" ? blankSpans(stripHash(content), rubyBlockCommentSpans(content))
      : syntax === "hcl" || syntax === "hjson" ? stripHcl(content)
      : kind!.family === "hash" ? stripHash(content)
      : stripLineHash(content);
    return { view, kindReadingMs, kindReadingStopped: true };
  } finally {
    kindReadingStopsAt = Infinity;
  }
}

/** The view of a mode without a kind reader, as `contentForGuards` has always given it. */
function familyView(syntax: Syntax, content: string): string {
  if (syntax === "c-like") return stripCLike(content, true);
  if (syntax === "css") return stripCLike(content, false);
  if (syntax === "hash") return stripHash(content);
  if (syntax === "line-hash") return stripLineHash(content);
  if (syntax === "php") return stripPhp(content);
  if (syntax === "sql") return stripSql(content);
  if (syntax === "markdown") return stripMarkdown(content);
  // The FIVE engine template modes, named explicitly rather than tested with `syntax in
  // TEMPLATE_COMMENTS`. That test used to be exact and stopped being so on 2026-08-19, when the
  // ruling cut the engine's modes to five while the marker catalogue kept all eight for
  // a check. `Syntax` no longer admits the other three, so the loose test could
  // not fire today — but it would silently start running a removed mode the moment anyone put one
  // back in `BY_EXT`, which is exactly the decision the ruling reserved.
  if (ENGINE_TEMPLATE_MODES.has(syntax)) return stripTemplate(content, syntax as TemplateMode);
  return stripMarkup(content);
}

/**
 * COMMENT FORMS A REGISTERED MODE READS AS CODE: the class that hid Ruby's `=begin`, made countable.
 *
 * `files_comment_syntax_unregistered` asks one question of a file: is ANY comment grammar registered
 * for its extension? A family registration (`hash`, `line-hash`, `c-like`, `css`) answers yes for a
 * language whose comment grammar is LARGER than the family's, so a hole inside a mode is invisible to
 * it by construction. That is how `=begin … =end` was read as code in every `.rb` file while the
 * counter read 0.
 *
 * WHAT THIS IS: a declaration, per extension, of each comment form the language has and the
 * registered mode does not read, with a test for its presence. The test runs on the GUARD VIEW - the
 * text `contentForGuards` leaves, which is what every rule reads as code - so a form counts only where
 * it really survived as code: the day a mode learns a form, the view blanks it and the count goes to 0
 * without anyone editing this table. The other direction is held by a test
 * part 3: every row's `mode` must still be what `syntaxFor` answers for each of its extensions, so a
 * re-registration cannot leave a row describing a mode the file no longer gets.
 *
 * WHAT IT COUNTS: FILES, one per file carrying at least one declared form, and per form the files
 * carrying it. It never changes what is read, never enters `files_comment_syntax_unregistered`, the
 * read-scope `complete` flag or its sentence; it is a size, not a repair.
 *
 * A PYTHON DOCSTRING IS COUNTED AND STAYS CODE. It was decided on 2026-09-24 that a docstring is
 * read as code, because rules read docstring text on purpose (`eu-dsr-005`, `eu-dsr-008` clause 13a).
 * Counting it does not reopen that decision; it states how many files the decision reaches, as the
 * Elixir documentation attributes beside it are stated.
 *
 * THE TESTS ARE LINE-ANCHORED, AND APPROXIMATE WHERE SAID. Exact for POD, `;`, `!` and a SCSS-family
 * `//` line (each is a comment wherever its line starts with it). `python-docstring` counts a line
 * that OPENS with a triple-quoted string, which is every docstring and also a triple-quoted argument
 * written on a line of its own. `elixir-doc-attribute` counts `@moduledoc`, `@doc` and `@typedoc`
 * followed by a string. `nested-block-comment` counts the trace a nested comment leaves in a
 * non-nesting reading: a `*\/` left as code because the comment closed at the INNER `*\/`. It skips a
 * `*\/` preceded by `*` or `/` (a glob such as `**\/*.kt`) and one after an odd number of `"` on its
 * line (inside a string, such as `"*\/*"`); a tail that itself holds `//` hides its `*\/` and is not
 * counted. `ruby-embedded-document` counts a `=begin` line left in the view; see its row. Not
 * declared, and so not counted: comments inside the `<script>`/`<style>` bodies of
 * markup files beyond what `markup` reads, MySQL's `#` in `.sql`, and Ruby's and Perl's `__END__`
 * sections (data, not comments).
 */
export interface CommentFormReadAsCode {
  /** The form's name in `stats.comment_forms_read_as_code`. Several rows may share one. */
  readonly form: string;
  /** What `syntaxFor` answers for every extension of this row; held by the gate. */
  readonly mode: Syntax;
  readonly extensions: readonly string[];
  /** Is the form present in this file's guard view, that is, read as code? */
  readonly present: (guardView: string) => boolean;
}

function nestedCommentTrace(view: string): boolean {
  let at = view.indexOf("*/");
  while (at !== -1) {
    const before = at > 0 ? view[at - 1] : "";
    if (before !== "*" && before !== "/") {
      const lineStart = view.lastIndexOf("\n", at - 1) + 1;
      const quotes = (view.slice(lineStart, at).replace(/\\./g, "").match(/"/g) ?? []).length;
      if (quotes % 2 === 0) return true;
    }
    at = view.indexOf("*/", at + 2);
  }
  return false;
}

export const COMMENT_FORMS_READ_AS_CODE: readonly CommentFormReadAsCode[] = [
  { form: "perl-pod", mode: "perl", extensions: ["pl", "pm"], present: (v) => /^=[A-Za-z]/m.test(v) },
  { form: "ini-semicolon", mode: "ini", extensions: ["ini"], present: (v) => /^[ \t]*;/m.test(v) },
  { form: "ini-semicolon", mode: "line-hash", extensions: ["cfg"], present: (v) => /^[ \t]*;/m.test(v) },
  { form: "properties-bang", mode: "properties", extensions: ["properties"], present: (v) => /^[ \t]*!/m.test(v) },
  {
    form: "python-docstring", mode: "python", extensions: ["py", "pyi"],
    present: (v) => /^[ \t]*(?:[rRuUbB]{1,2})?(?:"""|''')/m.test(v),
  },
  {
    form: "elixir-doc-attribute", mode: "elixir", extensions: ["ex", "exs"],
    present: (v) => /^[ \t]*@(?:moduledoc|doc|typedoc)[ \t]+(?:~[sS])?["']/m.test(v),
  },
  {
    form: "scss-line-comment", mode: "css", extensions: ["scss", "sass", "less", "styl"],
    present: (v) => /^[ \t]*\/\//m.test(v),
  },
  // Ruby's own block, which the `ruby` mode reads since 2026-09-24: declared so that the hole this
  // table exists for is counted wherever it reopens - a file Prism refuses keeps `hash`'s reading
  // (fix-rb-py-comments report § 11), and a mode that lost the form would show here. A `=begin` that
  // is string content (a heredoc body) is code by right and is counted too; that is the approximation.
  { form: "ruby-embedded-document", mode: "ruby", extensions: ["rb", "rake"], present: (v) => /^=begin(?:[ \t\r]|$)/m.test(v) },
  {
    form: "nested-block-comment", mode: "c-like", extensions: ["rs", "kt", "kts", "swift", "scala", "dart"],
    present: nestedCommentTrace,
  },
];

/** The distinct form names, in declaration order: the keys `stats.comment_forms_read_as_code` always carries. */
export const COMMENT_FORM_NAMES: readonly string[] = [...new Set(COMMENT_FORMS_READ_AS_CODE.map((r) => r.form))];

/**
 * The declared forms this file's guard view still holds as code, each name once. Empty for every file
 * whose extension no row names, and for a file whose registration has moved off the row's mode.
 */
export function commentFormsReadAsCode(fileName: string, guardView: string): string[] {
  const slash = fileName.lastIndexOf("/");
  const base = slash >= 0 ? fileName.slice(slash + 1) : fileName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return [];
  const ext = base.slice(dot + 1).toLowerCase();
  const found: string[] = [];
  for (const row of COMMENT_FORMS_READ_AS_CODE) {
    if (!row.extensions.includes(ext) || found.includes(row.form)) continue;
    if (syntaxFor(fileName) !== row.mode) continue;
    if (row.present(guardView)) found.push(row.form);
  }
  return found;
}
