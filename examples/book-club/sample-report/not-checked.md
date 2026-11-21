# Not checked: book-club

[Back to the report](report.md)

Nothing on this page has been decided. Anything listed here may still hold
a problem; reading it is the way to know.

## What this scan did not establish

### Checks that found nothing

101 checks found nothing, which does not prove the code is fine; 100 of
them are below.

### Seen in the code, reported by no check

The review looked into these checks and found what each one looks for at
the lines quoted below, although the check itself reported nothing. They
are not counted among the findings, and no review judged whether they are a
problem. Read each one: if it is a problem in your code, fix it as you
would a finding.

- eu-consent-010 — Tracking identifier stored in the browser (ePrivacy
  Directive 2002/58/EC, Art. 5(3)): what this check looks for is in the
  code, at the lines below, and the check did not report it.
  - Evidence: `public/index.html:14` — `gtag("config", "G-XXXXXXXXXX");`
  - Evidence: `public/index.html:9` —
    `<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>`
  - Evidence: `public/app.js:23` —
    `fbq("init", "000000000000000", { em: fields.email });`
  - Evidence: `public/index.html:20` —
    `<script async src="https://connect.facebook.net/en_US/fbevents.js"></script>`
- eu-dsr-003 — Account deletion by overwrite or reassignment (General Data
  Protection Regulation, Regulation (EU) 2016/679, Art. 17(1)): what this
  check looks for is in the code, at the lines below, and the check did not
  report it.
  - Evidence: `src/account.ts:19-20` —
    `db.prepare("UPDATE members SET closed = 1 WHERE id = ?").run(row.id); res.json({ deleted: true });`
  - Evidence: `src/account.ts:7` —
    `// "Delete my account": the member confirms with their e-mail and password.`
  - Evidence: `src/db.ts:6-13` —
    `CREATE TABLE IF NOT EXISTS members ( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, avatar_url TEXT,`
  - Evidence: `PRIVACY.md:20` —
    `When you close your account, we delete your personal data within 30 days.`
- eu-dsr-004 — Deleted users stay recognisable through a hash (General Data
  Protection Regulation, Regulation (EU) 2016/679, Art. 17(1)): what this
  check looks for is in the code, at the lines below, and the check did not
  report it.
  - Evidence: `src/avatar.ts:5` —
    `const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");`
  - Evidence: `src/avatar.ts:6` —
    ``return `https://www.gravatar.com/avatar/${hash}?s=80&d=identicon`;``
  - Evidence: `src/signup.ts:18-21` —
    `const avatarUrl = avatarUrlFor(email); const result = db .prepare("INSERT INTO members (name, email, password_hash, avatar_url) VALUES (?, ?, ?, ?)") .run(name, email, passwordHash, avatarUrl);`

### Looked for and not found

- ai-transparency-006 — AI service key that may reach the browser:
  searched, and nothing was found.
  - Searched: `The scan's record lists no removed lines for this rule.`
  - Searched:
    `Grep over the product tree for dangerouslyAllowBrowser|OPENAI|VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_ plus framework template binds (bind:value, v-model, :value, value={): 0 hits for the browser-allowing flag or an inlined key prefix. …`
  - Searched:
    ``Read src/assistant.ts in full. The OpenAI client is built server-side in an Express route (`const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });`), and the route POST /api/ask returns only the answer text.``
  - Searched:
    ``Read public/app.js and public/index.html in full. The browser calls `fetch("/api/ask", ...)` and imports no OpenAI SDK. There is no component framework and no build tool that inlines environment variables; the only build step is `tsc` (package.json:8).``
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- baseline-002 — Secret in the code, secret-named setting, or keychain use:
  searched, and nothing was found.
  - Searched:
    `The scan's record lists no lines removed by the corroboration gate for this rule, so there were none to open.`
  - Searched:
    `Grep over the whole product tree (excluding the scan's own .legal/ folder, whose hits were discarded) for password|secret|token|api[_-]?key|apikey|BEGIN .*PRIVATE|sk-|eyJ|VITE_|NEXT_PUBLIC|REACT_APP: hits are only form-field names, bcrypt code and a password_hash column (src/signup.ts…`
  - Searched:
    `Read in full: src/assistant.ts, src/server.ts, public/app.js, public/index.html and Dockerfile. The Dockerfile's only ENV line is NODE_ENV=production DB_FILE=/data/book-club.sqlite. There is no .env or compose file, and no Swift or keychain code.`
  - Searched:
    `Checked the two ID-like literals in the browser files: public/app.js:23 holds fbq('init', '000000000000000', ...) and public/index.html:9 and 14 hold G-XXXXXXXXXX. Both are placeholders, not credentials.`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- baseline-005 — Cookie with no Secure flag found: it can go over plain
  HTTP: searched, and nothing was found.
  - Searched: `The scan's record lists no removed lines for this rule.`
  - Searched:
    `Grep over the product tree for cookie|set-cookie|setcookie|res.cookie|document.cookie|session|express-session|cookie-parser|secure: in src/, public/, Dockerfile, package.json: 0 code hits. The only hit for 'cookie' is the prose in PRIVACY.md:14-16 ("We use only the cookies the site needs to work.").`
  - Searched:
    `Read src/server.ts in full: no session or cookie middleware, only express.json, express.static and three routers. package.json declares no session or cookie package (express, bcryptjs, better-sqlite3 and openai only).`
  - Searched: `Read public/app.js in full: it sets no cookies directly.`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- baseline-007 — Token kept in browser storage that scripts can read:
  searched, and nothing was found.
  - Searched: `The scan's record lists no removed lines for this rule.`
  - Searched:
    `Grep over the product tree for localStorage|sessionStorage|setItem|getItem|indexedDB: 0 hits in src/, public/ and the rest of the tree.`
  - Searched:
    ``Read public/app.js (53 lines) and public/index.html in full. The inline scripts only set up dataLayer, gtag and fbq. app.js keeps the member's name in a DOM attribute (`ask.dataset.name = fields.name;`, line 31), not in Web Storage.``
  - Searched:
    `The login or token vocabulary the rule's first shape lists (token, jwt, auth) appears nowhere in the browser files.`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- eu-consent-009 — Tracking cookie set by the product's own code: searched,
  and nothing was found.
  - Searched:
    `Grep over the whole repository for document.cookie, _ga=, _fbp=, _gid, _fbc, '_ga': 0 hits`
  - Searched:
    `Grep for cookie across all files: only PRIVACY.md:14 and :16 (prose)`
  - Searched:
    `Opened public/app.js and public/index.html in full: no cookie assignment and no quoted tracker-name literal`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- eu-consent-016 — Consent answers: record of who agreed, to what, and
  when: searched, and nothing was found.
  - Searched:
    `Grep (case-insensitive) over the whole repository except the lockfile for consent|accept|agree|opt|persist|localStorage|sessionStorage|cookie|setItem: no consent decision is read, gated on, signalled or declared in any source file; the only cookie mention is prose at PRIVACY.md:14-16`
  - Searched:
    `Grep for subscri|newsletter|marketing|session|store|Allow|Decline|Reject|Refuse|Deny (enum or status vocabulary for opt-in states): 0 hits in code`
  - Searched:
    `Opened public/app.js and public/index.html in full: no consent state, flag or enum`
  - Searched:
    `The scan's own vocabulary search (consent, cookie banner, gtag consent call, TCF, the consent-management platforms, opt out, GDPR): 0 files out of 14. I treated that as one spelling set, not as proof of absence, and ran the searches above as well`
  - Searched: `No path under .legal/ was opened or used`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- eu-consent-017 — Consent given: an equally easy way to withdraw it:
  searched, and nothing was found.
  - Searched:
    `Grep over the whole repository for consent|accept|agree|grant|termsAccepted|ad_storage|analytics_storage|denied|granted|oauth: 0 hits in code`
  - Searched:
    `Grep for localStorage|sessionStorage|document.cookie|setItem|res.cookie|Set-Cookie|session: 0 hits`
  - Searched:
    `Opened public/app.js in full: the only writes are fetch POSTs to /api/signup and /api/ask`
  - Searched:
    `Checked for a gtag('consent', ...) call: none. The only gtag calls are gtag('js'), gtag('config') and gtag('event') (public/index.html:13-14, public/app.js:22)`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- eu-consent-021 — Consent banner with Accept but no Refuse found beside
  it: searched, and nothing was found.
  - Searched:
    `Grep over the whole repository for Accept|Agree|I agree|Continue|Allow|Decline|Reject|Refuse|Deny: 0 hits`
  - Searched:
    `Opened public/index.html in full: the only buttons are 'Join the club' (line 31) and 'Ask' (line 40), both form submits`
  - Searched:
    `Checked the scan's file census: the only HTML file is public/index.html, with no banner markup and no consent vocabulary in the file`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- eu-consent-022 — Data stored on the visitor's device (cookie or storage):
  searched, and nothing was found.
  - Searched:
    `Grep over the whole repository for setItem|localStorage|sessionStorage|document.cookie|indexedDB|res.cookie|Set-Cookie|setHeader|persist: 0 hits in own source`
  - Searched:
    `Opened public/app.js and public/index.html in full: no direct write to the visitor's device by the project's own code`
  - Searched:
    `Looked for state libraries that persist a store (Pinia, redux-persist, zustand, vuex): none among the 8 declared dependencies in package.json (express, bcryptjs, better-sqlite3, openai, plus type packages and typescript)`
  - Searched: `Looked for server-side cookie construction in src/: 0 hits`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- eu-dsr-010 — Personal data copied into a search index, dump or export:
  searched, and nothing was found.
  - Searched:
    `Grep (case-insensitive) for export|download|attachment|zip|csv|dump|index|backup|search|Content-Disposition|send_data|sendFile across the whole tree except lockfiles: the only hit is src/server.ts's sendFile of PRIVACY.md, which is a static policy text and not a data copy.`
  - Searched:
    `Grep for elasticsearch, sphinx, meilisearch, solr, algolia, typesense, embedding, vector, materialized view, sqlite FTS: 0 hits.`
  - Searched:
    ``Read src/db.ts: a single `members` table, with no derived or search table, view or index definition.``
  - Searched:
    `Read public/app.js and listed public/: no Blob, createObjectURL, download attribute or file-saver call.`
  - Searched:
    `Read the Dockerfile: the SQLite file sits on a /data volume and no dump or backup job exists in the tree.`
  - Searched:
    `Read package.json dependencies (express, bcryptjs, better-sqlite3, openai): no search, export or spreadsheet library.`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- eu-retention-001 — Retention setting with no time limit by default:
  searched, and nothing was found.
  - Searched:
    `Grep (case-insensitive) over the whole tree outside the run's own working folder for retent|retain|expir|ttl|purge|delete|cleanup|setInterval|setTimeout|maxAge|older|interval|prune|days: 5 hits in all, none a retention or expiry setting (Dockerfile:8 npm prune, INSTALL.md:12 'in this folder'…`
  - Searched:
    `Read src/db.ts in full (the only schema): no retention-, expiry- or period-named setting, column or constant; no never/unlimited option or sentinel default`
  - Searched: `Read src/account.ts in full: no configurable period`
  - Searched:
    `Grep in src/ for created_at|timestamp|Date.now|datetime|session|token|cron|schedule|log: only db.ts:13 created_at, which has a NOT NULL default, and a console.log in signup.ts:10`
  - Searched:
    `The scan had no rule-removed lines for this rule (none were recorded). Hits under .legal/ were not opened or used`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- eu-retention-002 — Retention period whose deletion switch is off by
  default: searched, and nothing was found.
  - Searched:
    `Grep (case-insensitive) for retent|expir|ttl|purge|delete|cleanup|prune|days over the whole tree outside the run's own working folder: no deletion-switch key set to false and no retention period key in any source or config file`
  - Searched:
    `Read src/db.ts, src/account.ts, package.json-adjacent Dockerfile hits and PRIVACY.md: no configuration structure that pairs a deletion switch with a retention period`
  - Searched:
    `The scan had no rule-removed lines for this rule (none were recorded). Hits under .legal/ were not opened or used`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- eu-retention-003 — Retention period set in the database or
  infrastructure: searched, and nothing was found.
  - Searched:
    `Read src/db.ts in full: one CREATE TABLE IF NOT EXISTS members, with no TTL clause, no expiry index and no age-based DELETE`
  - Searched:
    `Grep for DELETE|DROP|ttl|expir|older|interval across src/, Dockerfile, INSTALL.md and package.json: the only hit is the HTTP delete route in src/account.ts:8, which runs an UPDATE and not a DELETE statement`
  - Searched:
    `Glob of the whole tree: no migrations directory, no .sql files, no Terraform, CloudFormation or bucket lifecycle files, no stored procedures`
  - Searched:
    `The scan had no rule-removed lines for this rule (none were recorded). Hits under .legal/ were not opened or used`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- eu-retention-004 — Retention period written into the code: searched, and
  nothing was found.
  - Searched:
    `Grep (case-insensitive) for retent|retain|expir|ttl|maxAge|max-age|setInterval|setTimeout|cleanup|purge|prune|older|days over the whole tree outside the run's own working folder: no constant, config key, cleanup argument, routine named for removing expired data or scheduler registration`
  - Searched:
    `Read src/account.ts, src/db.ts, src/signup.ts and src/server.ts hits for cron|schedule|Date.now: none`
  - Searched:
    `The scan had no rule-removed lines for this rule (none were recorded). Hits under .legal/ were not opened or used`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.
- safeguard-reach-001 — "Delete everything" promise beside the code that
  does it: searched, and nothing was found.
  - Searched:
    ``Grep (case-insensitive) for all|every|everything|permanent|forever|no copies|wiped|erased over the whole tree except lockfiles: 1 hit, src/signup.ts:13 `Please fill in every field.`, which is form validation and not a deletion claim.``
  - Searched:
    ``Read PRIVACY.md in full: its only deletion statement is line 20, `When you close your account, we delete your personal data within 30 days.`, which carries no total quantifier such as all, everything or permanently.``
  - Searched:
    `Grep for delet|close|account|remove in public/ (index.html, app.js): 0 hits, so no user-facing deletion or reset message is shown in the page.`
  - Searched:
    ``Read src/account.ts: the closing route answers only `{ deleted: true }`, with no message text claiming totality.``
  - Searched:
    `Searched for message catalogues or localisation files: the orientation sheet counts 0 localisation catalogues or directories.`
  - The review quoted no line of code for this search, so the program had
    nothing to check it against.

### Not looked into

82 checks found nothing, which does not prove the code is fine. Nobody
looked into them further.

<details>
<summary>The 82 checks, one line each, with what each looks for</summary>

- acting-as-subject-001 — Actions sent in a person's name while they are
  not there
- ai-inference-002 — Setting that adds user identity to AI model requests
- ai-inference-003 — MCP tools that can give personal data to an AI
  assistant
- ai-inference-004 — Local AI model infers new details from a person's
  content
- ai-inference-005 — AI picks where a request with the user's credentials
  goes
- ai-prohibited-001 — Emotion inference named in the code
- ai-prohibited-002 — Face recognition database: where the images come from
- ai-prohibited-003 — Race or belief labels that may come from biometric
  data
- ai-prohibited-004 — Image generator: safeguards against fake nude images
- ai-transparency-003 — AI-generated images: marking them as AI-made
- ai-transparency-004 — AI-generated voice or audio: marking it as AI-made
- ai-transparency-005 — Therapy or counselling wording in an AI feature
- ai-transparency-007 — Emotion or biometric recognition: telling people it
  runs
- baseline-003 — Plain-text connection scheme (http://, ws:// and the like)
- baseline-004 — Other websites may be allowed to call the server (CORS)
- baseline-006 — A secret carried in a URL
- baseline-008 — Mail connection in plain text, or with encryption optional
- baseline-009 — Service connection or app setting that allows plain text
- baseline-010 — Certificate checks off or replaced, or old TLS allowed
- delegated-access-001 — Bulk data about many people fetched on one
  person's account
- delegated-access-002 — The product logs in for the person at another
  service
- derived-personal-data-001 — Accounts matched as one person, then acted on
  automatically
- derived-personal-data-002 — Assessments about a person kept as records of
  their own
- derived-personal-data-003 — Past anonymous activity re-linked to a person
- derived-personal-data-004 — Location worked out from a visitor's IP
  address
- device-telemetry-001 — Continuous tracking data about people
- device-telemetry-002 — Records from a person's device uploaded with their
  identity
- eu-accessibility-001 — Page markup failing a basic accessibility check
- eu-consent-003 — TikTok Pixel may run before consent
- eu-consent-004 — PostHog may start capturing before consent
- eu-consent-005 — Session recording tool may run before consent
- eu-consent-007 — YouTube embed on the domain that sets cookies
- eu-consent-008 — AdSense ads may load before consent
- eu-consent-011 — Error reports set to include personal data (Sentry)
- eu-consent-012 — Browser fingerprinting library in the product
- eu-consent-013 — Analytics tool in the product
- eu-consent-015 — Ad network script may load before consent
- eu-consent-018 — Marketing messages: opt-in and opt-out
- eu-consent-020 — Session recording may capture screen content or typing
- eu-consent-023 — Third-party script added from a configured address
- eu-consent-024 — Session recording built into the product
- eu-data-act-001 — Data export or published API: switching providers
- eu-dsa-001 — Content people can post: a way for others to report it
- eu-dsa-002 — Moderation or account restriction: reasons to the person
- eu-dsr-005 — People's names and e-mails written into public Git history
- eu-dsr-006 — Deleted content that moderators can still read
- eu-dsr-007 — Remote wipe of a person's device, reported back
- eu-dsr-008 — Changes to personal data kept in an append-only log
- eu-dsr-009 — Claimed separation of a submitter from what they submitted
- eu-dsr-011 — Viewer's identity stamped into a served document or image
- eu-market-001 — Country or locale checks: access and payment conditions
- eu-retention-005 — Storage lock that can stop data being deleted
- eu-special-categories-001 — Health data named in the code
- eu-special-categories-002 — Biometric identification data named in the
  code
- eu-special-categories-003 — Origin, belief, union or sexuality data named
  in the code
- eu-special-categories-004 — Genetic data named in the code
- exposure-surface-001 — Admin or debug path to personal data
- exposure-surface-002 — Endpoint to personal data outside the usual
  sign-in
- exposure-surface-003 — Access decisions made inside the database
- extension-code-001 — Module fetched at start-up that holds people's
  records
- extension-code-002 — User-written scripts run with access to secrets
- federation-001 — Reports or moved-account data sent to other servers
- federation-002 — Deletion timing promised for people on other servers
- federation-003 — Account signing keys stored encrypted
- identity-issuance-001 — User details released to another service at
  sign-in
- identity-issuance-002 — User records written into another organisation's
  directory
- platform-store-001 — Personal data in a store the device itself owns
- platform-store-002 — App's private data allowed into the device's cloud
  backup
- presence-001 — Online status broadcast to others and stored
- recipients-001 — Payment company that may receive data
- recipients-002 — Storage or delivery company that may receive data
- recipients-005 — E-mail or chat company that may receive data
- recipients-007 — Cloud region the data is stored in
- recipients-008 — Browser details sent in the product's own usage events
- recipients-009 — Open and click tracking with a per-person identifier
- recipients-010 — Personal data sent over sockets, queues or in media URLs
- recipients-011 — Claim that split data cannot be rebuilt by any one party
- recipients-012 — Claim that the service cannot read what it stores
- recipients-013 — Usage-report address, call, ID header or default-on
  setting
- recipients-014 — Visitor IDs shared and matched with another company
- remote-actuation-001 — Remote command can trigger a device on a person's
  body
- remote-actuation-002 — Remote control of someone's computer, with a
  hidden mode

</details>

### Checks set aside by your answers

- ai-transparency-002 — Companion-chatbot wording: AI notice and user
  safety: its laws are those of the US, where you said the product is not
  offered; it ran and found nothing, and because of your answer the scan
  did not look further into why.

### What this scan did not read

- No test files, bundled third-party code or build output were found in
  this tree, so nothing was skipped as such.
- Paths the scanner refuses by rule: 1 directory holding files not counted
  — machine-written trees and files (such as \.git and dependency lock
  files) and dot-directories other than \.well-known and \.github. There is
  no option that opens them. WolfBoy's own \.legal folder (25 files, this
  scan's own records) is not counted here.
- Files that could not be read as code: none in this tree. There is no
  option that changes this.
- Checks run: all 120 that this version has. 1 of them depend on a question
  about the product that no answer gave, and your answers put 5 out of
  scope; all of them ran anyway.
- 101 checks of the 120 that ran found nothing, which does not prove the
  code is fine; each one is listed on this page.

### Questions open

- 2 questions about the product are open: 1 changes only the order; 1
  decides whether 1 check applies. Also 6 facts to check outside the code
  would decide 6 findings to answer; the scan has no question for them.
  Every question in words, and how to answer without Claude:
  [laws.md](laws.md#questions-open). Answer them for the next scan: say
  "review my answers" to Claude.

### Answers this scan did not take at face value

- **AI media** (you answered No) — ai-transparency-003 (AI-generated
  images: marking them as AI-made) ran and raised nothing, so this pass did
  not contradict the answer.
- **User content** (you answered No) — eu-dsa-001 (Content people can post:
  a way for others to report it); eu-dsa-002 (Moderation or account
  restriction: reasons to the person) ran and raised nothing, so this pass
  did not contradict the answer.
- **Data service** (you answered No) — eu-data-act-001 (Data export or
  published API: switching providers) ran and raised nothing, so this pass
  did not contradict the answer.
- **European Accessibility Act (EAA) service** (you answered None of these)
  — eu-accessibility-001 (Page markup failing a basic accessibility check)
  ran and raised nothing, so this pass did not contradict the answer.

Nothing to list in this run under: Checks switched off; Files that were not
read; Lines that were not read.

---

*This report is informational only and does not constitute legal advice. It
identifies code that may not meet a cited standard and that requires human
review; consult qualified counsel before acting on it.*
