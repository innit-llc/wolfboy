# book-club · compliance review · 15 Nov 2026

- **Needs your action: 15**: 14 to fix (12 high, 0 medium, 2 low) · 0 to
  clarify · 1 to answer, which 1 question settles ("review my answers")
- **Taken off the list: 2**: [2 ruled out](ruled-out.md) by one AI review
  each, which can miss a real problem
- [Laws](laws.md): Cyber Resilience Act unresolved (4 questions about the
  product open) · your answers, 15 Nov · each place reviewed once

## Not checked
- Nothing here is known to be in order. Places without a verdict: **0** ·
  findings the AI read only in part: **0**
- Rules that found nothing: 106, which is not a clean result: [each][4]
- Not read: 19+ files in machine-written folders (node_modules, .git and
  the like): [every file](not-checked.md)
- Privacy policy not compared: say "compare my privacy policy"

## Fix first
- F1 · Password or key written to a log or console\
  high ⚑ · [a55229](findings/a55229.md) · [src/signup\.ts:10][1]
- F2 · Personal data with no complete rights-request route found (7
  places)\
  high ⚑ · [5693ad](findings/5693ad.md) · [src/account\.ts:19][2] +6 more
  places
- F3 · Personal data sent to an external service (3 places)\
  high · [9342cc](findings/9342cc.md) · [src/avatar\.ts:6][3] +2 more
  places

The other 8 to fix are [below, by area](#to-fix-by-area), in this order.

VS Code: Ctrl+Shift+V to format (Mac: Cmd+Shift+V) · Ctrl+click a link\
⚑ placed as if the worst case held

## To fix by area

Each line is one kind of problem, with where it is. Open a place for its
evidence, what the review said and what to do.

### Cookies, tracking and consent (7 high)

- **high** · Meta Pixel may run before consent (2):
  [`public/index.html:20`](findings/6170e3.md#finding-6170e3),
  [`public/app.js:23`](findings/6170e3.md#finding-75a6b8)
- **high** · Tracking script placed on a page (2):
  [`public/index.html:20`](findings/6256fd.md#finding-6256fd),
  [`public/index.html:9`](findings/6256fd.md#finding-6d654b)
- **high** · Google Tag Manager or Analytics may run before consent:
  [`public/index.html:9`](findings/37897b.md)
- **high** · Fonts or images fetched from another company on page view:
  [`src/avatar.ts:6`](findings/8573b1.md)
- **high** · Facebook SDK or plugin may contact Meta on page view:
  [`public/index.html:20`](findings/109a16.md)

### People's requests: access, export and deletion (1 high, 2 low)

- **high** · Where people's data is stored and read, for access requests:
  [`src/account.ts:19`](findings/5693ad.md)
- **low** · Erasure, export or objection action to review (2):
  [`src/account.ts:19`](findings/3548e7.md#finding-3548e7),
  [`src/account.ts:19`](findings/3548e7.md#finding-405716)

### Security basics (1 high)

- **high** · A password or key written to the logs:
  [`src/signup.ts:10`](findings/a55229.md)

### Who receives the data (1 high)

- **high** · Analytics, avatar or monitoring company that may get data:
  [`src/avatar.ts:6`](findings/9342cc.md)

### Safeguards that may not reach what they protect (1 high)

- **high** · Data-limiting control that cannot reach its target:
  [`src/account.ts:20`](findings/6710b0.md)

### Children (1 high)

- **high** · Sign-up: age check and parental consent:
  [`src/signup.ts:20`](findings/29fb32.md)

## To answer

These findings wait on your answers. The questions, in words, with what
each settles and how to answer it: [laws.md](laws.md#questions-open).

- **high** · Object storage, webhook or asset host that may receive data:
  [`src/avatar.ts:6`](findings/8973bd.md)

## Decided by you

No decisions recorded for this folder on this computer.

120 rules ran in this scan; 14 produced candidates; 106 produced none, and
16 of those were searched.

## About this report

Scanned 2026-11-15 · 11 files read · 120 rules · scan
`030fcf8a-430d-4077-9f3d-af1c2daed317`. Rules: bundle 0000\.00\.10924554,
sha256 a6b20af09e2ea53ac2c3a08211cfc2b807d3e432b9939fd172731a9f612745b9,
the one shipped with this program.

F-numbers are this folder's, on this computer; in commits and tickets,
quote the 6-character id.

---

*This report is informational only and does not constitute legal advice. It
identifies code that may not meet a cited standard and that requires human
review; consult qualified counsel before acting on it.*

[1]: ../app/src/signup.ts#L10
[2]: ../app/src/account.ts#L19
[3]: ../app/src/avatar.ts#L6
[4]: not-checked.md#rules-that-found-nothing
