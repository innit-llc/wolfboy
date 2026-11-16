# Compliance scan record · book-club

**Made on the team's own computer; nothing outside it confirms that WolfBoy made
this record.** Made with WolfBoy 0\.1\.0. The digests at the end tie it to the
evidence log the team can hand over, not to an unmodified program.

Prepared 15 Nov 2026 for: ______________ · by: ______________ (both filled in by
the team)

## What was examined

- Code: repository book-club, commit c4c7b51 (15 Nov 2026), 11 files read; 120
  rules, bundle 0000\.00\.10924554.
- Answers about the product: given on the computer that made this record, 15
  Nov 2026. Ships as: Web.
- How: one AI review (sonnet, effort high), in the team's own environment, of
  every matched place; each place reviewed once.
- Laws: Cyber Resilience Act unresolved (4 questions about the product open) ·
  your answers, 15 Nov.

## Not checked

- Places without a verdict: 0 · findings the AI read only in part: 0 · 106 rules
  found nothing, which does not mean their duties are met.
- Not read: 19\+ files in machine-written folders (node_modules, \.git and the
  like).
- The privacy policy was not compared with the code (WolfBoy compares them in a
  separate run, not part of this record).

## Results

| | Count |
|---|--:|
| **Needs action: 15** · to fix | 14 (12 high, 0 medium, 2 low) |
| · to clarify (a point of law, or code the AI could not read) | 0 |
| · to answer (questions about the product not answered) | 1 |
| **Taken off the list: 2** · ruled out by one AI review each, which can miss | 2 |

**Decided on the computer that made this record:** none. Review by qualified
counsel recommended on every finding to clarify and every decided one. Deeper
checks of findings that stand: none.

**Since an earlier review:** this run was compared with none.

**What this record cannot see:** contracts, data-processing agreements,
deployment settings, data flows at run time, and organisational measures.

Commit `c4c7b513718562d9f35d42509632b6a5e404c434` · bundle 0000\.00\.10924554,
sha256 `a6b20af09e2ea53ac2c3a08211cfc2b807d3e432b9939fd172731a9f612745b9` ·
evidence log sha256
`1f21b542dc7d811bff4d0fc10a7a6fd27a52db3015f62db4ddeb03e2f6375cbd`

This report is informational only and does not constitute legal advice. It
identifies code that may not meet a cited standard and that requires human
review; consult qualified counsel before acting on it.

---

## Findings that stand, by area

### Security basics

- **F1 · Password or key written to a log or console** · `src/signup.ts:10` ·
  GDPR Art. 5(1)(f) and Art. 32 (integrity and confidentiality; security of
  processing), Japan APPI (Act on the Protection of Personal Information, Act
  No. 57 of 2003), Art. 23, Japan APPI (Act on the Protection of Personal
  Information, Act No. 57 of 2003), Art. 26, United States, FTC Act Sec. 5 (15
  U\.S\.C. Sec. 45(a)(1) and (n)), California Civil Code Sec. 1798\.81\.5(b) ·
  to fix, high · `a55229`

### People's requests: access, export and deletion

- **F2 · Personal data with no complete rights-request route found (7 places)**
  · `src/account.ts:19` and 6 more places · General Data Protection Regulation,
  Regulation (EU) 2016/679, Arts. 15-22, General Data Protection Regulation,
  Regulation (EU) 2016/679, Art. 12(2)-(4), General Data Protection Regulation,
  Regulation (EU) 2016/679, Arts. 17(2) and 19, General Data Protection
  Regulation, Regulation (EU) 2016/679, Art. 11, General Data Protection
  Regulation, Regulation (EU) 2016/679, Art. 28(3)(e), General Data Protection
  Regulation, Regulation (EU) 2016/679, Art. 83(5)(b) and Art. 99(2) · to fix,
  high · `5693ad`
- **F11 · Rights route flaw: reach, access, format, timing or promise (2
  places)** · `src/account.ts:19` and 1 more place · General Data Protection
  Regulation, Regulation (EU) 2016/679, Arts. 15-22, General Data Protection
  Regulation, Regulation (EU) 2016/679, Art. 12(2)-(4), General Data Protection
  Regulation, Regulation (EU) 2016/679, Arts. 17(2) and 19, General Data
  Protection Regulation, Regulation (EU) 2016/679, Art. 5(2) and Art. 30(1),
  General Data Protection Regulation, Regulation (EU) 2016/679, Art. 28(3)(e)
  and (g), General Data Protection Regulation, Regulation (EU) 2016/679, Art.
  4(1) and Art. 11 · to fix, low · `3548e7`

### Who receives the data

- **F3 · Personal data sent to an external service (3 places)** ·
  `src/avatar.ts:6` and 2 more places · GDPR (Regulation (EU) 2016/679), Art.
  30(1)(d), GDPR (Regulation (EU) 2016/679), Art. 30(2), GDPR (Regulation (EU)
  2016/679), Art. 4(9), GDPR (Regulation (EU) 2016/679), Art. 4(1), California
  Consumer Privacy Act, Cal. Civ. Code Sec. 1798\.110(a)(4) (Title 1\.81\.5, as
  amended by the California Privacy Rights Act) · to fix, high · `9342cc`
- **F12 · Waits on your answer: Object storage, webhook or asset host that may
  receive data** · `src/avatar.ts:6` · GDPR (Regulation (EU) 2016/679), Art.
  30(1)(d), GDPR (Regulation (EU) 2016/679), Art. 30(2), GDPR (Regulation (EU)
  2016/679), Art. 4(9), GDPR (Regulation (EU) 2016/679), Art. 28(1) and Art.
  28(3), GDPR (Regulation (EU) 2016/679), Art. 30(5), GDPR (Regulation (EU)
  2016/679), Art. 44, California Consumer Privacy Act, Cal. Civ. Code Sec.
  1798\.110(a)(4) (Title 1\.81\.5, as amended by the California Privacy Rights
  Act) · to answer · `8973bd`

### Cookies, tracking and consent

- **F4 · Google tag or Analytics contacted, no consent gate found** ·
  `public/index.html:9` · ePrivacy Directive 2002/58/EC, Art. 5(3) (as amended
  by Directive 2009/136/EC), Directive 2009/136/EC, Art. 2(5), GDPR Art. 4(11)
  and Art. 7 (definition of consent; conditions for valid consent), CNIL
  Deliberation no. 2020-091 of 17 September 2020 adopting guidelines on the
  application of Art. 82 of the French Data Protection Act (the national
  transposition of ePrivacy Art. 5(3)) to read and write operations in a user's
  terminal, notably cookies and other trackers, CNIL, Sanctions and corrective
  measures · to fix, high · `37897b`
- **F5 · Meta Pixel runs with no consent gate found (2 places)** ·
  `public/index.html:20` and 1 more place · ePrivacy Directive 2002/58/EC, Art.
  5(3) (as amended by Directive 2009/136/EC), Directive 2009/136/EC, Art. 2(5),
  GDPR Art. 4(11) and Art. 7 (definition of consent; conditions for valid
  consent), EDPB Guidelines 2/2023 on the technical scope of Art. 5(3) of the
  ePrivacy Directive, Version 2\.0 (adopted 7 October 2024), section 3 use case
  · to fix, high · `6170e3`
- **F6 · Page view sends the visitor's IP to a font or image host** ·
  `src/avatar.ts:6` · GDPR Art. 6(1) (a legal basis is required for the
  processing; an IP address transmitted to a third-party provider is processed
  without one unless a basis applies), Munich Regional Court I (LG München I),
  final judgment of 20 January 2022, 3 O 17493/20 · to fix, high · `8573b1`
- **F7 · Tracking tag loads with the page, no consent gate found (2 places)** ·
  `public/index.html:20` and 1 more place · ePrivacy Directive 2002/58/EC, Art.
  5(3) (as amended by Directive 2009/136/EC) (prior consent for storing or
  accessing information on terminal equipment; tags executing before consent),
  Directive 2009/136/EC, Art. 2(5) · to fix, high · `6256fd`
- **F8 · Facebook SDK or plugin passes visitor data to Meta** ·
  `public/index.html:20` · Court of Justice of the European Union, judgment of
  29 July 2019, Fashion ID GmbH \& Co. KG v Verbraucherzentrale NRW eV, C-40/17,
  EU, Fashion ID, C-40/17, operative part point 4, GDPR Art. 94(2), GDPR Art.
  6(1), ePrivacy Directive 2002/58/EC, Art. 5(3) (as amended by Directive
  2009/136/EC) · to fix, high · `109a16`

### Safeguards that may not reach what they protect

- **F9 · Data-limiting control that does not reach its target** ·
  `src/account.ts:20` · GDPR (Regulation (EU) 2016/679), Art. 5(1)(e), the
  storage-limitation principle, GDPR (Regulation (EU) 2016/679), Art. 5(1)(a),
  GDPR (Regulation (EU) 2016/679), Art. 17(1), GDPR (Regulation (EU) 2016/679),
  Art. 5(2) · to fix, high · `6710b0`

### Children

- **F10 · Sign-up: age check or parental consent not found or weak (7 places)**
  · `src/signup.ts:20` and 6 more places · GDPR (Regulation (EU) 2016/679), Art.
  8, GDPR Art. 4(25), GDPR Art. 6(1)(a), GDPR Recital 38, GDPR Art. 83(4)(a),
  NATIONAL AGE, NOT VERIFIED AGAINST A PRIMARY SOURCE, NOT VERIFIED AGAINST THE
  NATIONAL ACT · to fix, high · `29fb32`

## Decisions

None recorded on the computer that made this record.

## Deeper checks

None of the findings that stand.

## Ruled out

2 findings were ruled out by one AI review each. The list is kept with the
report on the computer that made this record (ruled-out\.md), not in this
record.
