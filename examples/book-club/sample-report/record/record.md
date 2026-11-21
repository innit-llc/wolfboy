# Compliance scan record · book-club

**Made on the team's own computer; nothing outside it confirms that WolfBoy made
this record.** Made with WolfBoy 0\.1\.1. The digests at the end tie it to the
evidence log the team can hand over, not to an unmodified program.

Prepared 19 Nov 2026 for: ______________ · by: ______________ (both filled in by
the team)

## What was examined

- Code: the folder book-club, not tied to a commit (the folder is not in a git
  work tree), 14 files read; 120 rules, bundle 0000\.00\.13924891.
- Answers about the product: given on the computer that made this record, 19
  Nov 2026. CRA business: Yes · CRA network: Yes · CRA product: Yes · CRA
  supply: Yes · Region EU: Yes · Region US: No · and 10 more.
- How: one AI review (model not recorded), in the team's own environment, of
  every matched place; each place reviewed once.
- Laws: Cyber Resilience Act (CRA) likely applies (11 conditions only you can
  confirm) · your answers, 19 Nov.

## Not checked

- Places without a verdict: 0 · findings the AI read only in part: 0 · 101
  checks found nothing, which does not prove the code is fine.
- Not read: the \.git folder, which the scan never reads.
- The privacy policy was not compared with the code (WolfBoy compares them in a
  separate run, not part of this record).

## Results

| | Count |
|---|--:|
| **Needs action: 19** · to fix | 13 (12 high, 1 medium, 0 low) |
| · to clarify (a point of law, or code the AI could not read) | 0 |
| · to answer (a question about the product, or a fact to check outside the code) | 6 |
| **Taken off the list: 3** · judged not a problem by one AI review each, which can miss a real problem | 1 |
| · not counted (already met, not shipped, for operators, same as another) | 2 |

**Decided on the computer that made this record:** none. Review by qualified
counsel recommended on every finding to clarify and every decided one. Deeper
checks of findings that stand: none.

**Since an earlier review:** this run was compared with none.

**What this record cannot see:** contracts, data-processing agreements,
deployment settings, data flows at run time, and organisational measures.

bundle 0000\.00\.13924891, sha256
`d47a1b8a20b9cbe028f3e46e638f7420a27c1a896d3061e68c10be1e1c1bdaf6` · evidence
log sha256 `c25e2dd5638b38d8950e42e446d31d8c20277f93395eea0e8b164ac44e644fe4`

This report is informational only and does not constitute legal advice. It
identifies code that may not meet a cited standard and that requires human
review; consult qualified counsel before acting on it.

---

## Findings that stand, by area

### People's requests: access, export and deletion

- **F1 · Closing an account only flags the member row; name, e-mail and password
  hash stay in the database.** · `src/account.ts:8` · General Data Protection
  Regulation, Regulation (EU) 2016/679, Arts. 15-22, General Data Protection
  Regulation, Regulation (EU) 2016/679, Art. 12(2)-(4), General Data Protection
  Regulation, Regulation (EU) 2016/679, Arts. 17(2) and 19, General Data
  Protection Regulation, Regulation (EU) 2016/679, Art. 5(2) and Art. 30(1),
  General Data Protection Regulation, Regulation (EU) 2016/679, Art. 28(3)(e)
  and (g), General Data Protection Regulation, Regulation (EU) 2016/679, Art.
  4(1) and Art. 11 · to fix, high · `3548e7`
- **F9 · Closing an account only flags it; members' names and e-mails stay
  stored, and no export exists.** · `src/account.ts:14` and 6 more places ·
  General Data Protection Regulation, Regulation (EU) 2016/679, Arts. 15-22,
  General Data Protection Regulation, Regulation (EU) 2016/679, Art. 12(2)-(4),
  General Data Protection Regulation, Regulation (EU) 2016/679, Arts. 17(2) and
  19, General Data Protection Regulation, Regulation (EU) 2016/679, Art. 11,
  General Data Protection Regulation, Regulation (EU) 2016/679, Art. 28(3)(e),
  General Data Protection Regulation, Regulation (EU) 2016/679, Art. 83(5)(b)
  and Art. 99(2) · to fix, high · `5693ad`

### Security basics

- **F2 · New members' e-mail addresses and plain-text passwords are written to
  the server log at sign-up.** · `src/signup.ts:10` · GDPR Art. 5(1)(f) and Art.
  32 (integrity and confidentiality; security of processing), United States, FTC
  Act Sec. 5 (15 U\.S\.C. Sec. 45(a)(1) and (n)) · to fix, high · `a55229`

### Safeguards that may not reach what they protect

- **F3 · Members who close their account still have their name, e-mail and
  password hash kept in the database.** · `src/account.ts:19` · GDPR (Regulation
  (EU) 2016/679), Art. 5(1)(e), the storage-limitation principle, GDPR
  (Regulation (EU) 2016/679), Art. 17(1), GDPR (Regulation (EU) 2016/679), Art.
  5(1)(a), GDPR (Regulation (EU) 2016/679), Art. 5(2) · to fix, high · `6710b0`

### Cookies, tracking and consent

- **F4 · Visitors' browsers contact Google's tag service as soon as the page
  opens, before any consent choice.** · `public/index.html:9` · ePrivacy
  Directive 2002/58/EC, Art. 5(3) (as amended by Directive 2009/136/EC),
  Directive 2009/136/EC, Art. 2(5), GDPR Art. 4(11) and Art. 7 (definition of
  consent; conditions for valid consent), CNIL Deliberation no. 2020-091 of 17
  September 2020 adopting guidelines on the application of Art. 82 of the French
  Data Protection Act (the national transposition of ePrivacy Art. 5(3)) to read
  and write operations in a user's terminal, notably cookies and other trackers,
  CNIL, Sanctions and corrective measures · to fix, high · `37897b`
- **F5 · Meta Pixel runs with no consent check found** · `public/index.html:20`
  and 1 more place · ePrivacy Directive 2002/58/EC, Art. 5(3) (as amended by
  Directive 2009/136/EC), Directive 2009/136/EC, Art. 2(5), GDPR Art. 4(11) and
  Art. 7 (definition of consent; conditions for valid consent), EDPB Guidelines
  2/2023 on the technical scope of Art. 5(3) of the ePrivacy Directive, Version
  2\.0 (adopted 7 October 2024), section 3 use case · to fix, high · `6170e3`
- **F6 · New members' e-mail hashes and IP addresses go to Gravatar when their
  profile picture loads after sign-up.** · `src/avatar.ts:6` · GDPR Art. 6(1) (a
  legal basis is required for the processing; an IP address transmitted to a
  third-party provider is processed without one unless a basis applies), Munich
  Regional Court I (LG München I), final judgment of 20 January 2022, 3 O
  17493/20 · to fix, high · `8573b1`
- **F7 · Tracking script loads with the page, no consent check found** ·
  `public/index.html:20` and 1 more place · ePrivacy Directive 2002/58/EC, Art.
  5(3) (as amended by Directive 2009/136/EC) (prior consent for storing or
  accessing information on terminal equipment; tags executing before consent),
  Directive 2009/136/EC, Art. 2(5) · to fix, high · `6256fd`
- **F8 · Every visitor's IP address reaches Meta as soon as the page loads, with
  no prior choice.** · `public/index.html:20` · Court of Justice of the European
  Union, judgment of 29 July 2019, Fashion ID GmbH \& Co. KG v
  Verbraucherzentrale NRW eV, C-40/17, EU, GDPR Art. 94(2), Fashion ID, C-40/17,
  operative part point 4, GDPR Art. 6(1), ePrivacy Directive 2002/58/EC, Art.
  5(3) (as amended by Directive 2009/136/EC) · to fix, high · `109a16`

### AI features

- **F10 · Members using the Ask the club box are not told an AI model writes the
  answers.** · `src/assistant.ts:19` · EU AI Act (Regulation (EU) 2024/1689),
  Art. 50(1), EU AI Act (Regulation (EU) 2024/1689), Art. 2(12), Commission
  Guidelines on the implementation of the transparency obligations for certain
  AI systems under Article 50 of Regulation (EU) 2024/1689, C(2026) 5054 final,
  20\.7\.2026, Utah Artificial Intelligence Consumer Protection Act, Utah Code
  Sec. 13-77-103 (published-code recodification of the provision enacted as Sec.
  13-75-103 by S\.B. 226, 2025 General Session), effective 2025-05-07 and
  replacing the disclosure provision that S\.B. 149 (2024) had put at Sec.
  13-2-12 · to fix, high · `5f408f`
- **F17 · A member's first name and typed question are sent to OpenAI whenever
  they use the Ask box.** · `src/assistant.ts:26` · GDPR (Regulation (EU)
  2016/679), Art. 30(1)(d), GDPR (Regulation (EU) 2016/679), Art. 4(9), GDPR
  (Regulation (EU) 2016/679), Art. 28(1) and Art. 28(3), GDPR (Regulation (EU)
  2016/679), Art. 44, GDPR (Regulation (EU) 2016/679), Art. 9(1) · to answer ·
  `9ddaeb`

### Product security duties under the CRA

- **F11 · Clubs running this software get no address or policy for reporting
  security vulnerabilities to the maker.** · `INSTALL.md:16` and 2 more places ·
  Cyber Resilience Act (Regulation (EU) 2024/2847), Annex I, Part II
  (Vulnerability handling requirements), chapeau and points (5) and (6), Cyber
  Resilience Act (Regulation (EU) 2024/2847), Annex II (Information and
  instructions to the user), chapeau and point 2, Cyber Resilience Act
  (Regulation (EU) 2024/2847), Art. 13(8), (17) and (18), Cyber Resilience Act
  (Regulation (EU) 2024/2847), Art. 71(2), Cyber Resilience Act (Regulation (EU)
  2024/2847), Art. 14, Cyber Resilience Act (Regulation (EU) 2024/2847), Art.
  2(1) and the Art. 3 defined terms the rest of this rule turns on, Cyber
  Resilience Act (Regulation (EU) 2024/2847), Art. 24 and Art. 3(14), Cyber
  Resilience Act (Regulation (EU) 2024/2847), Art. 64(2), Cyber Resilience Act
  (Regulation (EU) 2024/2847), Recital 76 · to fix, medium · `ff41a3`
- **F16 · Clubs are only told a new version will be sent; the update channel is
  unspecified.** · `Dockerfile:1` · Cyber Resilience Act (Regulation (EU)
  2024/2847), Annex I, Part II (Vulnerability handling requirements), chapeau
  and points (2), (7) and (8), Cyber Resilience Act (Regulation (EU) 2024/2847),
  Art. 13(8), Art. 3(20) and Annex VII points 2(b) and 4, Cyber Resilience Act
  (Regulation (EU) 2024/2847), Art. 13(9), Cyber Resilience Act (Regulation (EU)
  2024/2847), Art. 13(6), Cyber Resilience Act (Regulation (EU) 2024/2847),
  Annex II (Information and instructions to the user), chapeau and points 7,
  8(c) and 8(e), Cyber Resilience Act (Regulation (EU) 2024/2847), Art. 13(10),
  Art. 3(30) and Recital 40, Cyber Resilience Act (Regulation (EU) 2024/2847),
  Recital 56, Art. 13(4) and Annex I Part I point (2)(c), Cyber Resilience Act
  (Regulation (EU) 2024/2847), Recital 57 and Recital 39, and the Article 3
  finding that neither term is defined, Cyber Resilience Act (Regulation (EU)
  2024/2847), the free-of-charge limb of Annex I Part II point (8) and its
  tailor-made carve-out, with Recital 64 and the parallel carve-out in Annex I
  Part I point (2)(b), Cyber Resilience Act (Regulation (EU) 2024/2847), Art.
  71(2), Cyber Resilience Act (Regulation (EU) 2024/2847), Article 2, Cyber
  Resilience Act (Regulation (EU) 2024/2847), Art. 24 and Art. 3(14), Cyber
  Resilience Act (Regulation (EU) 2024/2847), Art. 64(2), with Recital 31 and
  Recital 61 · to answer · `31480b`

### Children

- **F12 · The sign-up form asks no age, so children could join with no parental
  authorisation step.** · `public/index.html:27` and 5 more places · GDPR
  (Regulation (EU) 2016/679), Art. 8, GDPR Art. 4(25), by way of Directive (EU)
  2015/1535 Art. 1(1)(b), GDPR Art. 6(1)(a), GDPR Recital 38, GDPR Art.
  83(4)(a), Datenschutzgesetz (DSG), BGBl. I Nr. 165/1999, § 4 Abs. 4 in the
  wording of the Datenschutz-Anpassungsgesetz 2018 (BGBl. I Nr. 120/2017), loi
  du 30 juillet 2018 relative à la protection des personnes physiques à l'égard
  des traitements de données à caractère personnel, article 7, Закон за защита
  на личните данни, чл. 25в, inserted by § 26 of the amending act promulgated in
  Държавен вестник бр. 17 от 26\.02\.2019, Ν. 125(Ι)/2018, άρθρο 8(1)-(2), zákon
  č. 110/2019 Sb\., o zpracování osobních údajů, § 7, NATIONAL AGE \- DE 16,
  databeskyttelsesloven (lov nr. 502 af 23. maj 2018) § 6, stk. 2 og 3, amended
  by lov nr. 1783 af 28. december 2023 § 1 nr. 1, isikuandmete kaitse seadus § 8
  lõige 1, Ley Orgánica 3/2018 (LOPDGDD) artículo 7\.1, tietosuojalaki
  (1050/2018) 5 §, loi n° 78-17 du 6 janvier 1978, article 45 (the numbering
  after the recast by ordonnance n° 2018-1125 du 12 décembre 2018; the same rule
  was article 7-1, created by loi n° 2018-493 du 20 juin 2018 art. 20), νόμος
  4624/2019 (ΦΕΚ Α' 137/29\.08\.2019) άρθρο 21, Zakon o provedbi Opće uredbe o
  zaštiti podataka (Narodne novine 42/2018), članak 19. stavak 1, NATIONAL AGE
  \- HU 16, Data Protection Act 2018 (No. 7 of 2018), section 31(1), Codice in
  materia di protezione dei dati personali (d\.lgs. 196/2003) art. 2-quinquies,
  comma 1, inserted by d\.lgs. 101/2018, Lietuvos Respublikos asmens duomenų
  teisinės apsaugos įstatymas (as recast by įstatymas Nr. XIII-1426 of
  2018-06-30) 6 straipsnis, NATIONAL AGE \- LU 16, Fizisko personu datu
  apstrādes likums 33. pants, Subsidiary Legislation 586\.11, regulation 4,
  NATIONAL AGE \- NL 16, NATIONAL AGE \- PL 16, Lei n\.º 58/2019, de 8 de
  agosto, artigo 16\.º, NATIONAL AGE \- RO 16, lag (2018:218) med kompletterande
  bestämmelser till EU:s dataskyddsförordning, 2 kap. 4 §, Zakon o varstvu
  osebnih podatkov (ZVOP-2), Uradni list RS št. 163/22, 8. člen (1), zákon č.
  18/2018 Z. z. o ochrane osobných údajov, § 15 ods. 1 · to answer · `29fb32`

### Who receives the data

- **F13 · Each new member's e-mail fingerprint is sent to Gravatar whenever
  their picture is shown.** · `src/avatar.ts:6` · GDPR (Regulation (EU)
  2016/679), Art. 30(1)(d), GDPR (Regulation (EU) 2016/679), Art. 30(2), GDPR
  (Regulation (EU) 2016/679), Art. 4(9), GDPR (Regulation (EU) 2016/679), Art.
  28(1) and Art. 28(3), GDPR (Regulation (EU) 2016/679), Art. 30(5), GDPR
  (Regulation (EU) 2016/679), Art. 44 · to answer · `8973bd`
- **F14 · Visitors' browsers contact Meta's servers on page load, before any
  choice, revealing their IP address.** · `public/index.html:20` · GDPR
  (Regulation (EU) 2016/679), Art. 30(1)(d), GDPR (Regulation (EU) 2016/679),
  Art. 4(7), 4(8) and 4(9)\., GDPR (Regulation (EU) 2016/679), Art. 30(2) · to
  answer · `8cf648`
- **F15 · Visitors' browsers load Google's analytics script, and members' e-mail
  fingerprints go to Gravatar.** · `src/avatar.ts:6` and 2 more places · GDPR
  (Regulation (EU) 2016/679), Art. 30(1)(d), GDPR (Regulation (EU) 2016/679),
  Art. 30(2), GDPR (Regulation (EU) 2016/679), Art. 4(9), GDPR (Regulation (EU)
  2016/679), Art. 4(1) · to answer · `9342cc`

## Decisions

None recorded on the computer that made this record.

## Deeper checks

None of the findings that stand.

## Judged not a problem

1 finding was judged not a problem by one AI review each. The list is kept with
the report on the computer that made this record (ruled-out\.md), not in this
record.
