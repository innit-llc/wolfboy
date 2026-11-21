# book-club · compliance review · 19 Nov 2026

**19 findings need your action.** Each finding was reviewed once.
- 13 to fix: 12 high and 1 medium.
- 6 wait on you: 6 facts to check in your own documents.

1 more was judged not a problem, each by one AI review, which can miss a
real problem: [see it](#judged-not-a-problem). 2 more are listed below but
not counted as problems.

[Laws](laws.md): By your answers, 4 laws of the EU were applied. 2 laws of
the US stay in although you said the product is not offered there, because
that answer alone does not decide them. 4 laws of Japan and the US were
left out by your answers. For each of 1 law whose reach depends on what the
product is, the laws page says whether it applies: 11 conditions only you
can confirm. The scan used your answers of 19 Nov.

**Not checked**: every place the scan found was reviewed. 101 checks found
nothing, which does not prove the code is fine; not read: the `.git`
folder, which the scan never reads; 2 questions about the product are open;
also **1 check was** set aside by the regions you declared; **4 answers**
of yours not taken at face value; your privacy policy was not compared as a
whole. [What was not checked](#not-checked)

Seen in the code but reported by no check: **3**. Read each; each may be a
problem the scan did not count: [each](#not-checked)

## Fix first

- **[F1](findings/3548e7.md) · Closing an account only flags the member
  row; name, e-mail and password hash stay in the database.**\
  high ⚑ · [`src/account.ts:8`][1]\
  What to do (the AI review's suggestion; check it before applying):
  Hard-delete closed members' rows or purge within 30 days. The rule's
  general advice is on the finding's page.

All 13 to fix are listed [below, by area](#to-fix-by-area).

⚑ ranked by assuming the worst, because the review could not tell; the
finding's page says what.

## To fix by area

Each finding says what happened, the line of code, and what to do. Its page
has the evidence and the review's reasoning.

### Cookies, tracking and consent (7 high)

- **[F4](findings/37897b.md) · Visitors' browsers contact Google's tag
  service as soon as the page opens, before any consent choice.**\
  high · Google tag or Analytics loads with no consent check found\
  [`public/index.html:9`](../app/public/index.html#L9)\
  `<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXX…`\
  What to do (the AI review's suggestion; check it before applying): Load
  Google tag only after a recorded consent choice.\
  In general: Set Google's consent defaults to denied before any Google tag
  loads; load noscript or server tags only after consent.
- **[F5](findings/6170e3.md#finding-6170e3) (1 of 2) · Visitors' browsers
  load Meta's advertising script on page open, before any consent
  choice.**\
  high · Meta Pixel runs with no consent check found\
  [`public/index.html:20`](../app/public/index.html#L20)\
  `<script async src="https://connect.facebook.net/en_US/fbevents.js"></s…`\
  What to do (the AI review's suggestion; check it before applying): Load
  Meta script only after recorded consent.\
  In general: Load the pixel only after the visitor agrees, or start it
  revoked and grant consent on their choice; same for noscript.
- **[F5](findings/6170e3.md#finding-75a6b8) (2 of 2) · New members' e-mail
  addresses go to Meta's ad pixel on sign-up with no prior consent step.**\
  high · Meta Pixel runs with no consent check found\
  [`public/app.js:23`](../app/public/app.js#L23)\
  `fbq("init", "000000000000000", { em: fields.email });`\
  What to do (the AI review's suggestion; check it before applying): Send
  fbq init only after recorded consent.\
  In general: Load the pixel only after the visitor agrees, or start it
  revoked and grant consent on their choice; same for noscript.
- **[F6](findings/8573b1.md) · New members' e-mail hashes and IP addresses
  go to Gravatar when their profile picture loads after sign-up.**\
  high · Font or image from another company gets the visitor's IP\
  [`src/avatar.ts:6`](../app/src/avatar.ts#L6)\
  ``return `https://www.gravatar.com/avatar/${hash}?s=80&d=identicon`;``\
  What to do (the AI review's suggestion; check it before applying): Render
  the identicon locally instead of requesting Gravatar.\
  In general: Serve fonts and images from your own origin (self-host,
  generate or cache them), or make the remote fetch opt-in.
- **[F7](findings/6256fd.md#finding-6256fd) (1 of 2) · Every visitor's
  browser contacts Meta as the page loads, and signed-up members' e-mails
  are sent to Meta.**\
  high · Tracking script loads with the page, no consent check found\
  [`public/index.html:20`](../app/public/index.html#L20)\
  `<script async src="https://connect.facebook.net/en_US/fbevents.js"></s…`\
  What to do (the AI review's suggestion; check it before applying): Inject
  the Meta pixel only after the visitor consents.\
  In general: Load the tag only after the visitor agrees; for a tag manager
  snippet, first set the vendor's consent default to denied.
- **[F7](findings/6256fd.md#finding-6d654b) (2 of 2) · Every visitor's page
  view goes to Google's tracking tag as the page loads, before they are
  asked.**\
  high · Tracking script loads with the page, no consent check found\
  [`public/index.html:9`](../app/public/index.html#L9)\
  `<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXX…`\
  What to do (the AI review's suggestion; check it before applying): Load
  the Google tag only after the visitor consents.\
  In general: Load the tag only after the visitor agrees; for a tag manager
  snippet, first set the vendor's consent default to denied.
- **[F8](findings/109a16.md) · Every visitor's IP address reaches Meta as
  soon as the page loads, with no prior choice.**\
  high ⚑ · Facebook SDK or plugin passes visitor data to Meta\
  [`public/index.html:20`](../app/public/index.html#L20)\
  `<script async src="https://connect.facebook.net/en_US/fbevents.js"></s…`\
  What to do (the AI review's suggestion; check it before applying): Load
  the Meta script only after a recorded consent decision.\
  In general: Load the SDK after recorded consent or on a click, or call
  the Graph API from your server; tell visitors what Meta gets.

### People's requests: access, export and deletion (2 high)

- **[F1](findings/3548e7.md) · Closing an account only flags the member
  row; name, e-mail and password hash stay in the database.**\
  high ⚑ · Problem found in a delete, export or opt-out feature\
  [`src/account.ts:8`](../app/src/account.ts#L8)\
  What to do (the AI review's suggestion; check it before applying):
  Hard-delete closed members' rows or purge within 30 days.\
  In general: Make the feature act on every copy of the data, or record why
  a copy is kept, and give people a way to ask for it.
- **[F9](findings/5693ad.md) · Closing an account only flags it; members'
  names and e-mails stay stored, and no export exists.**\
  high · No full way found for people to get, fix or erase data\
  [`src/account.ts:14`](../app/src/account.ts#L14) +6 more places\
  What to do (the AI review's suggestion; check it before applying): Erase
  closed members' rows; add a member data export.\
  In general: Let people get, correct, export and erase their data; delete
  rows, not only mark them; tell those you shared it with.

### Security basics (1 high)

- **[F2](findings/a55229.md) · New members' e-mail addresses and plain-text
  passwords are written to the server log at sign-up.**\
  high · Password or key written to a log or console\
  [`src/signup.ts:10`](../app/src/signup.ts#L10)\
  `console.log("new signup", { name, email, password });`\
  What to do (the AI review's suggestion; check it before applying): Remove
  the password from the log call; log no credentials.\
  In general: Drop the secret from the log call or log a masked form, and
  set up redaction in the shared logger where one is used.

### Safeguards that may not reach what they protect (1 high)

- **[F3](findings/6710b0.md) · Members who close their account still have
  their name, e-mail and password hash kept in the database.**\
  high · Delete, expiry or limit step that misses its data\
  [`src/account.ts:19`](../app/src/account.ts#L19)\
  `db.prepare("UPDATE members SET closed = 1 WHERE id = ?").run(row.id);`\
  What to do (the AI review's suggestion; check it before applying): Delete
  the member row, or scrub its personal fields, on close.\
  In general: Make the step act on the data: delete flagged rows, clear
  every copy, set an expiry, or fix what switches it off.

### AI features (1 high)

- **[F10](findings/5f408f.md) · Members using the Ask the club box are not
  told an AI model writes the answers.**\
  high ⚑ · Chat users: clear notice that they talk to an AI not found\
  [`src/assistant.ts:19`](../app/src/assistant.ts#L19)\
  `const completion = await openai.chat.completions.create({`\
  What to do (the AI review's suggestion; check it before applying): Label
  the Ask box as an AI assistant.\
  In general: Tell users on the first screen of the chat that they are
  talking to an AI, and keep a visible label in the conversation.

### Product security duties under the Cyber Resilience Act (CRA) (1 medium)

- **[F11](findings/ff41a3.md) · Clubs running this software get no address
  or policy for reporting security vulnerabilities to the maker.**\
  medium ⚑ · Vulnerability disclosure policy or contact not found\
  [`INSTALL.md:16`](../app/INSTALL.md#L16) +2 more places\
  `docker run -d -p 3000:3000 -v book-club-data:/data --env-file club.env…`\
  What to do (the AI review's suggestion; check it before applying): Add
  SECURITY\.md with a security mailbox; link it in INSTALL\.md.\
  In general: Publish a vulnerability disclosure policy and a reporting
  contact; the CRA asks both of products placed from Dec 2027.

## To check in your own documents

These findings wait on a fact the code cannot show. Each one names the
fact; check it in your own records, such as your record of processing.

- **[F12](findings/29fb32.md) · The sign-up form asks no age, so children
  could join with no parental authorisation step.**\
  high ⚑ · Sign-up: age check and parental consent\
  [`public/index.html:27`](../app/public/index.html#L27) +5 more places\
  `<form id="signup">`\
  What to check in your own documents: Whether the club service is offered
  directly to children, with consent as the basis for processing at sign-up
  (GDPR, Art. 8).
- **[F13](findings/8973bd.md) · Each new member's e-mail fingerprint is
  sent to Gravatar whenever their picture is shown.**\
  high · Object storage, webhook or asset host that may receive data\
  [`src/avatar.ts:6`](../app/src/avatar.ts#L6)\
  ``return `https://www.gravatar.com/avatar/${hash}?s=80&d=identicon`;``\
  What to check in your own documents: Whether the operator's processing
  record lists Gravatar as a recipient of members' hashed e-mail addresses
  (GDPR, Art. 30(1)(d)).
- **[F14](findings/8cf648.md) · Visitors' browsers contact Meta's servers
  on page load, before any choice, revealing their IP address.**\
  high · Line naming a sign-in or access-check company\
  [`public/index.html:20`](../app/public/index.html#L20)\
  `<script async src="https://connect.facebook.net/en_US/fbevents.js"></s…`\
  What to check in your own documents: Whether the operator's processing
  record lists Meta as a recipient of visitors' and members' data (GDPR,
  Art. 30(1)(d)).
- **[F15](findings/9342cc.md) · Visitors' browsers load Google's analytics
  script, and members' e-mail fingerprints go to Gravatar.**\
  high · Analytics, avatar or monitoring company that may get data\
  [`src/avatar.ts:6`](../app/src/avatar.ts#L6) +2 more places\
  ``return `https://www.gravatar.com/avatar/${hash}?s=80&d=identicon`;``\
  What to check in your own documents: Whether the operator's processing
  record lists Google Analytics and Gravatar as recipients of visitor and
  member data (GDPR, Art. 30(1)(d)).
- **[F16](findings/31480b.md) · Clubs are only told a new version will be
  sent; the update channel is unspecified.**\
  medium ⚑ · Update delivery path, or a pinned runtime version\
  [`Dockerfile:1`](../app/Dockerfile#L1) · `FROM node:22-slim`\
  What to check in your own documents: How the maker delivers, signs and
  keeps security updates, and when support ends, for installed clubs (Cyber
  Resilience Act, Annex I, Part II, chapeau and points (2), (7) and (8)).
- **[F17](findings/9ddaeb.md) · A member's first name and typed question
  are sent to OpenAI whenever they use the Ask box.**\
  high · Personal data or documents sent to an AI model\
  [`src/assistant.ts:26`](../app/src/assistant.ts#L26)\
  ``{ role: "user", content: `${name}: ${question}` },``\
  What to check in your own documents: Whether the club's record of
  processing lists OpenAI as a recipient of members' names and questions
  (GDPR, Art. 30(1)(d)).

## Findings that share a line of code

Each of these lines is named by more than one finding. Each finding is
still counted and needs its own look; this list only shows where they meet.

- [`public/index.html:9`](../app/public/index.html#L9):
  [F4](findings/37897b.md) and [F7](findings/6256fd.md)
- [`public/index.html:20`](../app/public/index.html#L20):
  [F5](findings/6170e3.md), [F7](findings/6256fd.md),
  [F8](findings/109a16.md) and [F14](findings/8cf648.md)
- [`src/avatar.ts:6`](../app/src/avatar.ts#L6): [F6](findings/8573b1.md),
  [F13](findings/8973bd.md) and [F15](findings/9342cc.md)

## Not checked

- No part of the code is declared free of problems. Places without a
  verdict: **0**. Findings the AI read only in part: **0**.
- 101 checks found nothing, which does not prove the code is fine:
  [each][2]
- Not read: the `.git` folder, which the scan never reads: [details][3]
- Questions about the product open: 2 ([each](laws.md#questions-open))
- Also not checked: **1 check was** set aside by the regions you declared;
  **4 answers** of yours not taken at face value; your privacy policy as a
  whole (a finding that quotes it looked at that line only; to compare it,
  say "compare my privacy policy").
- Seen in the code but reported by no check: **3**. Read each; each may be
  a problem the scan did not count:
  [each](not-checked.md#seen-in-the-code-reported-by-no-check)

## Judged not a problem

1 finding was judged not a problem, each by one AI review, which can miss a
real problem. [ruled-out.md](ruled-out.md) has it in full.

<details>
<summary>The finding, each with its reason</summary>

- Records served with no sign-in found, unlike nearby routes, at
  [`src/server.ts:8`](../app/src/server.ts#L8): The matched line only
  builds the path of the public/ folder, which line 12 of the same file
  serves as static files (index\.html, app\.js, style\.css). That is the
  site's own page and script, not a route over members' records.
  ([its page](ruled-out/records-served-with-no-sign-in.md))

</details>

## Decided by you

No decisions recorded for this folder on this computer.

## Recorded: duty met, exempt, or a record of processing

- **high** · AI-written content: telling people it is AI-made:
  [`src/assistant.ts:19`](findings/aeaad6.md)
  - [`src/assistant.ts:19`](findings/aeaad6.md): Recorded: your answer "AI
    text: No" settles it.

## Counted with another finding

Each does the same processing as another finding of the same rule, named
beside it, and is counted with that finding, not on its own: as a problem
only where that finding is one. Each keeps its own page and evidence.

- **high** · Delete, export or opt-out feature found, to review:
  [`PRIVACY.md:20`](findings/405716.md)
  - [`PRIVACY.md:20`](findings/405716.md): Counted with
    [F1](findings/3548e7.md) (listed above): the review traced this line to
    `src/account.ts:19` of that finding.

## About this report

120 checks ran. 19 matched something. 101 matched nothing; the review
looked further into 18 of those.

Scanned 2026-11-19 · 14 files read · 120 checks · scan
`22082467-4789-4ed9-8003-46be67ce4221`. Rules: NOT the rules shipped with
this program. The scan ran bundle 0000\.00\.13924891, sha256
d47a1b8a20b9cbe028f3e46e638f7420a27c1a896d3061e68c10be1e1c1bdaf6, and every
finding below comes from its rules.

F-numbers are this folder's, on this computer; in commits and tickets,
quote the 6-character id.

For your team or an auditor: say "make a record of the review", and Claude
writes one under `.legal/records/`.

Your decisions about findings ("decide F1: …") are kept on this computer,
for this folder; they do not go with the repository.

In VS Code, Ctrl+Shift+V (Mac: Cmd+Shift+V) opens the preview, and
Ctrl+click opens a link.

---

*This report is informational only and does not constitute legal advice. It
identifies code that may not meet a cited standard and that requires human
review; consult qualified counsel before acting on it.*

[1]: ../app/src/account.ts#L8
[2]: not-checked.md#checks-that-found-nothing
[3]: not-checked.md#what-this-scan-did-not-read
