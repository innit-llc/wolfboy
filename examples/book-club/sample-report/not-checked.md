# Not checked: book-club

[Back to the report](report.md)

Nothing on this page is decided. A place here may hold a problem; reading
it is the way to know.

## WHAT WAS NOT ESTABLISHED

### Rules that found nothing

106 rules found nothing in this scan; each is below. Finding nothing is not
a clean result.

### *gap found — detector missed it*

- eu-consent-010 — Tracking identifier written directly to Web Storage
  (localStorage / sessionStorage), or set by an SDK default: the construct
  was found and this rule did not raise it.
  - Evidence: `public/index.html:14` — `gtag("config", "G-XXXXXXXXXX");`
  - Evidence: `public/index.html:9` —
    `<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>`
  - Evidence: `public/index.html:20` —
    `<script async src="https://connect.facebook.net/en_US/fbevents.js"></script>`
  - Evidence: `public/app.js:23` —
    `fbq("init", "000000000000000", { em: fields.email });`
- eu-dsr-004 — Deletion writes a one-way derivation of the erased
  identifier, keeping the person recognisable - GDPR Art. 17(1): the
  construct was found and this rule did not raise it.
  - Evidence: `src/avatar.ts:5` —
    `const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");`
  - Evidence: `src/signup.ts:21` —
    `.run(name, email, passwordHash, avatarUrl);`
  - Evidence: `src/account.ts:19` —
    `db.prepare("UPDATE members SET closed = 1 WHERE id = ?").run(row.id);`
- recipients-002 — Storage, delivery or picture-serving vendor named in the
  tree - candidate recipient for the record of processing activities: the
  construct was found and this rule did not raise it.
  - Evidence: `src/avatar.ts:6` —
    `return 'https://www.gravatar.com/avatar/${hash}?s=80&d=identicon';`
  - Evidence: `src/avatar.ts:5` —
    `const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");`
  - Evidence: `src/signup.ts:18` — `const avatarUrl = avatarUrlFor(email);`
  - Evidence: `public/app.js:27` —
    `welcome.innerHTML = '<img src="${member.avatarUrl}" alt="" width="40" height="40" /> Welcome, ${fields.name}!';`

### *apparently absent — searched, nothing found*

- baseline-002 — A live-credential literal, a secret-named configuration
  key, or a platform-keychain call, key or type: searched, and nothing was
  found.
  - Searched:
    `Read in full: src/server.ts, src/signup.ts, src/avatar.ts, src/db.ts, public/index.html, public/app.js (src/account.ts and package.json were covered by the grep below only). These are the product's whole source tree: 5 .ts files, 3 files in public/, PRIVACY.md.`
  - Searched:
    `Grep (case-insensitive) for secret|password|token|api[_-]?key over the whole tree: the only hits are the form field name 'password' (public/index.html:30), the destructured request field and the bcrypt hash column (src/signup.ts, src/account.ts, src/db.ts), and prose in PRIVACY.md. …`
  - Searched:
    `The same grep over the tree returned no hit for BEGIN PRIVATE KEY, an eyJ JWT, a vendor key prefix (sk_, AKIA and the like) or a user:password@ connection URI. This covers the shapes of the shape-based clauses. I did not run a separate grep for each prefix.`
  - Searched:
    `Looked for config and environment files (.env, compose, Dockerfile, yaml) with a Glob of the repository root: none exist. The only root files are PRIVACY.md, package.json, tsconfig.json, public/ and src/. I discarded the .legal/ entries that Glob also listed.`
  - Searched:
    `Looked for keychain use: the project is Node/TypeScript with no Swift or Objective-C files, so none was found.`
  - Searched:
    `No suppressed_by_corroboration entries exist for this rule, so there were no gate-removed lines to open.`
  - This row carried no quotation, so nothing about it was checked.
- baseline-003 — Plaintext transport: a URL whose scheme has no TLS
  (http://, ws://, ldap://, redis:// and the like) in a string or
  configuration value, or an HTTP connection without TLS: searched, and
  nothing was found.
  - Searched:
    `Grep for http:// , ws://, ftp://, ldap://, redis://, amqp://, mqtt://, smtp:// over the whole tree (the first with the broader grep): 0 hits. Every URL in the tree uses https://.`
  - Searched:
    `Grep (case-insensitive) for https:// over the whole tree: 3 hits, all TLS: public/index.html:9 (googletagmanager.com), public/index.html:20 (connect.facebook.net), src/avatar.ts:6 (www.gravatar.com).`
  - Searched:
    `Read public/app.js and src/server.ts in full: the only fetch is the relative '/api/signup' (public/app.js:8), and app.listen(port) (src/server.ts:17) opens a plain-HTTP listener with no TLS and no URL on the line.`
  - Searched:
    `Looked for HttpConnection/port-80 style calls by reading all five .ts files: none exist.`
  - This row carried no quotation, so nothing about it was checked.
- baseline-004 — CORS wildcard, allow-all switch, reflected origin, a
  constructor called with no origins, a computed origin, or the header set
  to any value - the admitted origin set needs review: searched, and
  nothing was found.
  - Searched:
    `Grep (case-insensitive) for cors|Access-Control|origin|helmet over the whole tree: 0 hits for cors and Access-Control. The only 'origin' text hit came from the broad grep and none was in source.`
  - Searched:
    `Read src/server.ts in full: the middleware is express.json() (:10) and express.static (:11). There is no cors() call, no res.header or res.set call, and no CORS dependency.`
  - Searched:
    `package.json dependencies as listed in the orientation sheet: express, bcryptjs, better-sqlite3 and the @types and typescript dev packages. There is no cors package.`
  - Searched:
    `No header-setting configuration files exist (no nginx, apache, vercel or netlify file) per the root Glob.`
  - This row carried no quotation, so nothing about it was checked.
- baseline-005 — Cookie set with no Secure attribute, with the attribute
  switched off, or with it emitted only under a runtime condition:
  searched, and nothing was found.
  - Searched:
    `Grep (case-insensitive) for cookie|session|Set-Cookie|res\.cookie|document\.cookie|express-session|cookie-parser over the whole tree: the only cookie hit is prose at PRIVACY.md:14 and :16 ('## Cookies' / 'We use only the cookies the site needs to work.'). There is no code hit for any of them.`
  - Searched:
    `Read src/server.ts, src/signup.ts, src/account.ts (via grep) and public/app.js in full: no cookie is written server-side or client-side, no session proxy assignment exists, and no secure: option is set. src/signup.ts returns JSON and sets no header.`
  - Searched:
    `Grep for 'secure' false/0 style settings and COOKIE_SECURE: 0 hits. No env or config files exist.`
  - Searched:
    `package.json lists no express-session, cookie-session or cookie-parser dependency (orientation sheet dependency list).`
  - This row carried no quotation, so nothing about it was checked.
- eu-consent-009 — Tracking cookie written directly from application code:
  searched, and nothing was found.
  - Searched: `Brief: no suppressed_by_corroboration entry for this rule.`
  - Searched:
    `Grep over the whole repo for document.cookie, _ga, _gid, _fbp, _fbc, _gcl: 0 hits in first-party code`
  - Searched:
    `Read public/app.js and public/index.html in full: no cookie assignment, and no quoted tracker-name literal with '='`
  - This row carried no quotation, so nothing about it was checked.
- eu-consent-016 — Consent decision read, gated on, signalled or declared -
  server-side record of who, what and when needs review: searched, and
  nothing was found.
  - Searched:
    `Brief: no suppressed_by_corroboration entry names this rule, so no removed lines to open.`
  - Searched:
    `Grep (case-insensitive) over the whole repo for consent|opt|accept|agree|allow|confirmed|unsubscribed|subscri|newsletter|marketing: only hits are 'options' in tsconfig.json:2 and PRIVACY.md cookie text; 0 consent-decision reads, gates or declarations`
  - Searched:
    `Grep over src/ for cookie|session|setHeader|subscri|newsletter|marketing|status: only HTTP res.status(...) calls (src/account.ts:15, src/signup.ts:13, 23); no consent or subscription state`
  - Searched:
    `Read public/app.js (30 lines) and public/index.html (40 lines) in full: sign-up form has name, e-mail and password only, no checkbox or consent field; gtag and fbq calls are not gated on any variable`
  - Searched:
    `Orientation sheet consent-vocabulary rows (consent, opt out, gdpr and others): 0 files each`
  - This row carried no quotation, so nothing about it was checked.
- eu-consent-021 — Consent-banner acceptance control surfaced with no
  refusal vocabulary matched in the same file outside comments: searched,
  and nothing was found.
  - Searched: `Brief: no suppressed_by_corroboration entry for this rule.`
  - Searched:
    `Grep (case-insensitive) over the whole repo for accept|agree|allow|continue|consent|banner: no acceptance control or banner; only the form submit button 'Join the club' (public/index.html:31)`
  - Searched:
    `Read public/index.html and public/app.js in full: no dialog, banner or consent surface exists, and neither accept nor refuse controls`
  - This row carried no quotation, so nothing about it was checked.
- eu-consent-022 — Value written to the visitor's terminal equipment - Web
  Storage, IndexedDB or a cookie: searched, and nothing was found.
  - Searched: `Brief: no suppressed_by_corroboration entry for this rule.`
  - Searched:
    `Grep (case-insensitive) over the whole repo for localStorage|sessionStorage|setItem|document.cookie|indexedDB|persist|res.cookie|Set-Cookie|new Cookie: 0 hits in src/ and public/`
  - Searched:
    `Glob of src/** (account.ts, avatar.ts, db.ts, server.ts, signup.ts) and public/** (app.js, index.html, style.css); read app.js and index.html in full: no storage writes and no persisted-store libraries (package.json declares only express, bcryptjs, better-sqlite3 and types/typescript)`
  - This row carried no quotation, so nothing about it was checked.
- eu-dsr-003 — Account deletion re-attributes, nulls or overwrites the
  person's record instead of erasing it - GDPR Art. 17(1): searched, and
  nothing was found.
  - Searched:
    `Read all of src/account.ts, src/db.ts and src/avatar.ts (the whole deletion path and the schema)`
  - Searched:
    `Grep (case-insensitive) for SET NULL|nullify|anonym|reassign|DELETE FROM over the tree excluding lockfiles: 0 hits`
  - Searched:
    `Grep for placeholder overwrite or shared-identity names (deleted_user, guest, AnonymousUser) in src/ and public/: 0 hits`
  - Searched:
    `Glob **/* in src/: 5 files (account.ts, avatar.ts, db.ts, server.ts, signup.ts), none other holds a deletion path`
  - This row carried no quotation, so nothing about it was checked.
- eu-retention-003 — Retention period or age-based deletion written into a
  schema, a migration or an infrastructure artefact: searched, and nothing
  was found.
  - Searched:
    `No suppressed_by_corroboration entry names this rule (brief line 95), so there were no removed lines to open.`
  - Searched:
    `I read every file of the product: src/db.ts, src/account.ts, src/signup.ts, src/server.ts, src/avatar.ts, public/app.js, public/index.html and PRIVACY.md. The tree has no migrations directory, no Terraform or CloudFormation, and no SQL files.`
  - Searched:
    `Grep (case-insensitive) for retention|ttl|expir|purge|cleanup|setInterval|cron|DELETE FROM|30 days|INTERVAL|strftime|schedule over the whole tree: 1 hit, PRIVACY.md:20, which is prose and not a schema or infrastructure artefact.`
  - Searched:
    `Glob for all files in the tree: nothing else exists besides package.json, tsconfig.json and the files above. Paths under .legal/ were ignored.`
  - This row carried no quotation, so nothing about it was checked.
- eu-retention-004 — Retention period stated as a constant, a configuration
  key or a cleanup argument: searched, and nothing was found.
  - Searched:
    `No suppressed_by_corroboration entry names this rule, so there were no removed lines to open.`
  - Searched:
    `Grep (case-insensitive) for retention|ttl|expir|purge|cleanup|setInterval|cron|schedule over the whole tree: 1 hit, PRIVACY.md:20 ('we delete your personal data within 30 days'), which is a prose statement in a document and not a constant, configuration key or cleanup argument in code.`
  - Searched:
    `I read every .ts and .js file in full: src/server.ts, src/signup.ts, src/account.ts, src/db.ts, src/avatar.ts and public/app.js. I found no retention-named constant, no defaulted environment or property lookup carrying a period, and no routine declaration or scheduler registration.`
  - Searched:
    `The only environment lookups are process.env.DB_FILE (src/db.ts:3) and process.env.PORT (src/server.ts:16). Neither carries a period.`
  - This row carried no quotation, so nothing about it was checked.
- recipients-008 — First-party telemetry beacon - browser-supplied values
  assembled into an outbound event body: searched, and nothing was found.
  - Searched:
    `No suppressed_by_corroboration entry names this rule, so there were no removed lines to open.`
  - Searched:
    `Grep (case-insensitive) for sendBeacon|keepalive|new Image|XMLHttpRequest|document.referrer|location.href|navigator.|innerWidth|screen.|canonical|userAgent over the whole tree: 0 hits.`
  - Searched:
    `I read public/app.js and public/index.html in full. The only outbound call is the fetch at public/app.js:8-12. It sends the form fields the member typed (name, e-mail, password) to /api/signup. It sends no browser-supplied values such as URL, referrer, viewport, user agent or language.`
  - Searched:
    `I read src/server.ts and src/signup.ts. The server does not assemble a beacon or event body from request headers.`
  - This row carried no quotation, so nothing about it was checked.
- safeguard-reach-001 — Total deletion, clearing or reset claim served
  beside the routine that answers it: searched, and nothing was found.
  - Searched:
    `Grep (case-insensitive) for delet|remov|clear|reset|wipe|all |every|permanent in public/*, PRIVACY.md, src/server.ts, src/signup.ts: 2 hits, both not total deletion claims (src/signup.ts:13 'Please fill in every field.' is form validation; PRIVACY.md:20 is described below)`
  - Searched:
    `Grep for wipe|erase|purge|permanent|everything|all your data over the whole tree excluding lockfiles: 0 hits`
  - Searched:
    `Read src/account.ts in full: the only deletion string is the code comment at line 7 and the response { deleted: true } at line 20`
  - Searched:
    `Read the front end listing via Grep of public/app.js and public/index.html for deletion UI strings: 0 hits`
  - This row carried no quotation, so nothing about it was checked.

### *unknown — not checked*

- acting-as-subject-001 — Outbound action carried out under a person's own
  identity while that person is absent or uninvolved: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- ai-inference-001 — User identity and/or document content forwarded to an
  AI-inference model endpoint - candidate recipient, Art. 30(1)(d): the
  scan raised no place for this rule, so none is shown here; whether what
  it looks for is absent was not established
- ai-inference-002 — User-identity-forwarding toggle adds identity headers
  to an inference or image-generation request: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- ai-inference-003 — Model Context Protocol tool surface that can answer a
  connecting AI client with personal data: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- ai-inference-004 — A model runs locally over the person's own content and
  derives a new attribute from it: the scan raised no place for this rule,
  so none is shown here; whether what it looks for is absent was not
  established
- ai-inference-005 — Model chooses an outbound request whose host comes
  from a user-created row, with the user's credentials: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- ai-prohibited-001 — Affect-inference call, model or term named, screened
  against AI Act Art. 5(1)(f) - signal and setting need review: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- ai-prohibited-002 — Face template call, SDK or collection named, screened
  against AI Act Art. 5(1)(e) - image source and store need review: the
  scan raised no place for this rule, so none is shown here; whether what
  it looks for is absent was not established
- ai-prohibited-003 — Protected-characteristic label named, screened
  against AI Act Art. 5(1)(g) - biometric input needs review: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- ai-prohibited-004 — Nudification wording, safety control off, or
  image-generation surface - AI Act Art. 5 (ba)/(bb) from 2026-12-02: the
  scan raised no place for this rule, so none is shown here; whether what
  it looks for is absent was not established
- ai-transparency-001 — Language-model call, binding, endpoint or SDK entry
  point - conversational surface and AI disclosure need review: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- ai-transparency-002 — Companion-chatbot wording in a file that calls an
  LLM (CA SB 243 / NY scope): the scan raised no place for this rule, so
  none is shown here; whether what it looks for is absent was not
  established
- ai-transparency-003 — Image-generation call or generation-host
  reference - provenance marking and AI-origin disclosure need review: the
  scan raised no place for this rule, so none is shown here; whether what
  it looks for is absent was not established
- ai-transparency-004 — Speech-synthesis or voice-cloning API referenced -
  synthetic-audio marking and disclosure need review: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- ai-transparency-005 — Therapy or counselling wording in a file that calls
  or configures an LLM (IL / NV / UT scope): the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- ai-transparency-006 — dangerouslyAllowBrowser flag or client-inlined
  model-provider key name - whether a key reaches the browser needs review:
  the scan raised no place for this rule, so none is shown here; whether
  what it looks for is absent was not established
- ai-transparency-007 — Emotion-recognition or biometric-categorisation
  API - notice to the persons exposed needs review: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- ai-transparency-008 — Language-model call, publishing surface or
  generated-content wording - AI-origin disclosure to readers needs review:
  the scan raised no place for this rule, so none is shown here; whether
  what it looks for is absent was not established
- baseline-006 — Secret- or token-named URL query parameter: built for
  sending, or read from the query on receipt: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- baseline-007 — Token-named value written to Web Storage (localStorage /
  sessionStorage), or through a setItem call with no receiver on the line:
  the scan raised no place for this rule, so none is shown here; whether
  what it looks for is absent was not established
- baseline-008 — Mail transport without TLS or with STARTTLS left optional:
  an SMTP, IMAP or POP client or mailer setting that sends in the clear, or
  upgrades only if the server offers it: the scan raised no place for this
  rule, so none is shown here; whether what it looks for is absent was not
  established
- baseline-009 — Service connection or platform setting without TLS: a
  database, cache, queue, search, directory, gRPC or Docker API connection,
  or a mobile permission for plaintext traffic: the scan raised no place
  for this rule, so none is shown here; whether what it looks for is absent
  was not established
- baseline-010 — TLS protection weakened: certificate or host-name
  verification turned off or replaced, or a protocol version below TLS 1.2
  allowed: the scan raised no place for this rule, so none is shown here;
  whether what it looks for is absent was not established
- delegated-access-001 — Bulk personal data about many people fetched from
  a platform on a principal who is not the subject: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- delegated-access-002 — Product stands in the person's place at their
  institution: credential custody and relayed authentication: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- derived-personal-data-001 — Accounts re-linked by a derived identifier,
  with an automated adverse action on the match: the scan raised no place
  for this rule, so none is shown here; whether what it looks for is absent
  was not established
- derived-personal-data-002 — Assessments the product generates about a
  person and keeps as rows with their own lifecycle: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- derived-personal-data-003 — Historical pseudonymous events re-keyed to
  one identity when a declared attribute arrives, with the alias map kept:
  the scan raised no place for this rule, so none is shown here; whether
  what it looks for is absent was not established
- derived-personal-data-004 — A location derived from a visitor's IP
  address, and whether that derivation is in the record of processing: the
  scan raised no place for this rule, so none is shown here; whether what
  it looks for is absent was not established
- device-telemetry-001 — Continuous telemetry about tracked people,
  ingested over a device or change-stream protocol: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- device-telemetry-002 — Flow records generated on the person's own device,
  stamped with their identity and uploaded: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- eu-accessibility-001 — Markup, template or object-literal line matching a
  source-decidable accessibility check (EAA candidate): the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- eu-consent-003 — TikTok Pixel loaded - holdConsent gate needs review: the
  scan raised no place for this rule, so none is shown here; whether what
  it looks for is absent was not established
- eu-consent-004 — PostHog constructor or init call (browser or server
  SDK), or a snippet of one - opt-out-by-default capture needs review: the
  scan raised no place for this rule, so none is shown here; whether what
  it looks for is absent was not established
- eu-consent-005 — Session-replay SDK referenced, initialised or configured
  (Hotjar, FullStory, Clarity, LogRocket, Datadog RUM and peers): the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- eu-consent-007 — YouTube embed on the standard domain rather than
  youtube-nocookie.com: the scan raised no place for this rule, so none is
  shown here; whether what it looks for is absent was not established
- eu-consent-008 — AdSense script URL referenced, which may not be a load -
  consent signalling (TCF or Consent Mode) needs review: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- eu-consent-011 — Sentry send-default-PII set to true - whether this line
  is a live configuration, and data minimisation, need review: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- eu-consent-012 — Browser fingerprinting library referenced: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- eu-consent-013 — Analytics SDK referenced or initialised (Mixpanel,
  Amplitude, Segment/RudderStack/Jitsu/Customer.io, Matomo, Plausible): the
  scan raised no place for this rule, so none is shown here; whether what
  it looks for is absent was not established
- eu-consent-015 — Ad network host referenced (Criteo / Taboola / Outbrain
  / GPT) - per-vendor TCF consent needs review: the scan raised no place
  for this rule, so none is shown here; whether what it looks for is absent
  was not established
- eu-consent-017 — Consent grant written, or a symbol named for one -
  revocation path and its parity with granting need review: the scan raised
  no place for this rule, so none is shown here; whether what it looks for
  is absent was not established
- eu-consent-018 — Marketing-consent control, message template, send call,
  list write or vendor SDK - opt-in and opt-out need review: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- eu-consent-020 — Session-replay masking control written here - whether a
  recording would carry on-screen content or input needs review: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- eu-consent-023 — Third-party script injected into a public page from a
  configured URL - prior consent needs review: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- eu-consent-024 — This product implements its own session recorder - the
  capture call, the store it writes to, or the path that replays it: the
  scan raised no place for this rule, so none is shown here; whether what
  it looks for is absent was not established
- eu-cra-001 — Packaging, release, install, firmware or payment SDK - CRA
  vulnerability disclosure policy and contact (products placed from Dec
  2027): the scan raised no place for this rule, so none is shown here;
  whether what it looks for is absent was not established
- eu-cra-002 — Update delivery path or pinned runtime - CRA remediation,
  secure distribution and dissemination duties from 2027-12-11: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- eu-data-act-001 — Export path, or a published interface description -
  Data Act Arts. 23(c), 30(2) and 30(5) need checking: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- eu-dsa-001 — Store a recipient could write into - who supplies the
  content and the Art. 16 notice-and-action mechanism need review: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- eu-dsa-002 — Moderation or account-restriction path - statement of
  reasons to the recipient needs review: the scan raised no place for this
  rule, so none is shown here; whether what it looks for is absent was not
  established
- eu-dsr-005 — Contributor name and e-mail written into version-control
  history and pushed to public hosting - GDPR Art. 17(2): the scan raised
  no place for this rule, so none is shown here; whether what it looks for
  is absent was not established
- eu-dsr-006 — Deletion masks the content and keeps the original
  retrievable by peer moderators - GDPR Art. 17(1): the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- eu-dsr-007 — Server-commanded wipe of the person's own device, with
  completion reported back - GDPR Arts. 17(1) and 32(1): the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- eu-dsr-008 — Personal-data changes stored as immutable events in an
  append-only event store, with the read side served by projections: the
  scan raised no place for this rule, so none is shown here; whether what
  it looks for is absent was not established
- eu-dsr-009 — Declared unlinkability: a schema that severs submitter from
  submission, and its correlation channels: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- eu-dsr-010 — Personal data copied into a search index, a derived search
  table, an embedding store, a dump or an export archive, or handed out as
  an attachment or a browser download: the scan raised no place for this
  rule, so none is shown here; whether what it looks for is absent was not
  established
- eu-dsr-011 — Recipient-identifying values composited into a document or
  image at the moment it is served: the scan raised no place for this rule,
  so none is shown here; whether what it looks for is absent was not
  established
- eu-market-001 — Country or locale test, list, picker or geo lookup -
  access, rerouting or payment conditions need review (EU 2018/302): the
  scan raised no place for this rule, so none is shown here; whether what
  it looks for is absent was not established
- eu-retention-001 — Retention- or expiry-named setting whose shipped
  default is unbounded: a never-or-unlimited option or a sentinel: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- eu-retention-002 — Retention period bound in one structure to a deletion
  switch whose shipped default is off: the scan raised no place for this
  rule, so none is shown here; whether what it looks for is absent was not
  established
- eu-retention-005 — Vendor-side retention lock on storage holding personal
  data: object lock, blob immutability or file retention: the scan raised
  no place for this rule, so none is shown here; whether what it looks for
  is absent was not established
- eu-special-categories-001 — Health-related field, measurement or medical
  identifier named in code - GDPR Art 9(1) basis needs review: the scan
  raised no place for this rule, so none is shown here; whether what it
  looks for is absent was not established
- eu-special-categories-002 — Biometric template or
  identification/verification operation named - GDPR Art 9(1) purpose
  element needs review: the scan raised no place for this rule, so none is
  shown here; whether what it looks for is absent was not established
- eu-special-categories-003 — Racial or ethnic origin, political opinions,
  religion or belief, trade union, sex life or sexual orientation named:
  the scan raised no place for this rule, so none is shown here; whether
  what it looks for is absent was not established
- eu-special-categories-004 — Genome, genotype, variant-call or
  genetic-test vocabulary - GDPR Art. 9(1) person link and basis need
  review: the scan raised no place for this rule, so none is shown here;
  whether what it looks for is absent was not established
- exposure-surface-001 — Operator- or debug-grade access path over the
  personal-data store, beside the primary API: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- exposure-surface-002 — Standing endpoint over the personal-data store
  whose caller check is not the product's own account model: a local OS
  endpoint, or an auth middleware that self-disables: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- exposure-surface-003 — Disclosure authorisation delegated to, and decided
  inside, the data owner's own database: the scan raised no place for this
  rule, so none is shown here; whether what it looks for is absent was not
  established
- extension-code-001 — Operator-named module fetched at boot and run
  in-process, holding person records and its own egress: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- extension-code-002 — User-authored script stored as data, run in-process
  with resolved secrets and its own fetch: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- federation-001 — Report or migration payload delivered to a remote inbox
  chosen by protocol data - candidate recipient: the scan raised no place
  for this rule, so none is shown here; whether what it looks for is absent
  was not established
- federation-002 — Retention or erasure timing declared in-product for a
  data subject on another (remote) server: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- federation-003 — Federation-signing private key held under attribute
  encryption on an actor or keypair model: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- identity-issuance-001 — User attributes assembled into a token or
  assertion and released to a relying party: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- identity-issuance-002 — User records created or updated in a directory or
  application belonging to another domain: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- platform-store-001 — Personal data written into a store the operating
  system owns, which the app's own erasure does not reach: the scan raised
  no place for this rule, so none is shown here; whether what it looks for
  is absent was not established
- platform-store-002 — A declaration authorising the platform's backup
  service to copy the app's private data off the device: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- presence-001 — Live availability and behavioural state broadcast to a
  subscriber graph, and stored offline: the scan raised no place for this
  rule, so none is shown here; whether what it looks for is absent was not
  established
- recipients-001 — Payment vendor named in the tree - candidate recipient
  for Art. 30(1)(d) of the processing record: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- recipients-005 — Email or team-chat vendor named in the tree - candidate
  recipient for the record of processing activities: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- recipients-007 — Cloud region configured in this tree - where the
  deployment is set to put data, for Art. 30(1)(e): the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- recipients-009 — First-party open and click tracking - a per-recipient
  identifier in a pixel or redirect URL: the scan raised no place for this
  rule, so none is shown here; whether what it looks for is absent was not
  established
- recipients-010 — Personal data crossing a process boundary over a
  non-HTTP transport or in a media URL: the scan raised no place for this
  rule, so none is shown here; whether what it looks for is absent was not
  established
- recipients-011 — Datum split across recipients so none can reconstruct
  it - the non-collusion claim needs review: the scan raised no place for
  this rule, so none is shown here; whether what it looks for is absent was
  not established
- recipients-012 — Custodian stores and re-serves content it declares it
  cannot read - the blind-custody claim: the scan raised no place for this
  rule, so none is shown here; whether what it looks for is absent was not
  established
- recipients-013 — Telemetry from server or desktop code to a first-party
  or operator-configured endpoint - installation identifiers and an
  on-by-default setting; recipient and basis need review: the scan raised
  no place for this rule, so none is shown here; whether what it looks for
  is absent was not established
- recipients-014 — Cross-party identifier sync - a minted redirect with a
  placeholder for the counterpart's identifier, a per-counterpart pseudonym
  table on the terminal equipment, or its callback: the scan raised no
  place for this rule, so none is shown here; whether what it looks for is
  absent was not established
- remote-actuation-001 — A remote command relayed from a third party
  triggers a physical action on the person's body: the scan raised no place
  for this rule, so none is shown here; whether what it looks for is absent
  was not established
- remote-actuation-002 — Remote observation and control of another person's
  machine, with a mode that hides it from them: the scan raised no place
  for this rule, so none is shown here; whether what it looks for is absent
  was not established

### *not evaluated*

No entry in this run.

### *not applicable by declaration*

No entry in this run.

### *What this scan did not read*

- Test surfaces were not read: no path in this tree matched the 11 pattern
  set(s) of rules/path-exclusions/test-surfaces\.yaml, so nothing was held
  back on this account.
- Vendored code was not read: no path in this tree matched the 5 pattern
  set(s) of rules/path-exclusions/vendored-code\.yaml, so nothing was held
  back on this account.
- Build output was not read: no path in this tree matched the 2 pattern
  set(s) of rules/path-exclusions/generated-output\.yaml, so nothing was
  held back on this account.
- Paths the scanner refuses by rule: 2 directories holding 19\+ files, and
  0 files — machine-written trees and files (\.git, and dependency lock
  files) and dot-directories other than \.well-known and \.github. There is
  no option that opens them.
- Files that could not be read as code: none in this tree. There is no
  option that changes this.
- Rules run: 120 of 120 — every rule this bundle ships. Your answers about
  the product leave 11 rules turning on a question they do not answer and
  put 0 rules out of scope; every one of them ran anyway, and each answer
  is named on the rows it labels.
- Rules that ran and produced no candidate: 106 of 120. A rule that matched
  nothing has not established that the construct is absent, and each one is
  named in rules_without_candidates with what it was looking for.

### *Files that were not read*

No entry in this run.

### *Lines that were not read*

No entry in this run.

### *Questions open*

- 1 question would settle 1 finding to answer, and 1 question changes only
  the order; 6 more questions the rules read hold 11 rules open. Every
  question in words: [laws.md](laws.md#questions-open). Answer them for the
  next scan: say "review my answers" to Claude, or run
  `'<wolfboy>/product/plugin/bin/legal-scan' scan --target '.' --out '.legal/findings.json' --review-declaration`
  in a terminal.

### *Answers this scan did not take at face value*

No entry in this run.

---

*This report is informational only and does not constitute legal advice. It
identifies code that may not meet a cited standard and that requires human
review; consult qualified counsel before acting on it.*
