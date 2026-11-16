# Laws: book-club

[Back to the report](report.md)

Answers about the product this scan used: your answers of 15 Nov.

## Which instruments reach this project

- **Regulation (EU) 2024/2847 (Cyber Resilience Act)** (CRA Art. 2(1)):
  unresolved — 1 of 5 required limbs are settled (1 by the EU pack's
  premise); data-connection-in-intended-purpose-or-foreseeable-use is a
  fact about the product that the code suggests and only you can confirm,
  so it is not counted as met and has to be answered;
  is-a-product-with-digital-elements, supplied-for-distribution-or-use,
  in-the-course-of-a-commercial-activity are not shown by the code and have
  to be…
  - One answer for 4 checklists that ask the same questions of this tree:
    cra-annex3-important-products, cra-product-information-13-8,
    cra-reporting-readiness-14, cra-sbom-annex-i-ii-1
  - 4 questions decide whether this law reaches your product:
    - Is what this repository contains a software or hardware product
      within Article 3(1), counting its remote data processing solutions
      and counting a component \- software or hardware intended for
      integration into an electronic information system \- that is being
      placed on the market separately \- but not counting software that
      runs on your own servers and that people only reach remotely \- in a
      web… (`is-a-product-with-digital-elements`) The code shows nothing
      users install or run on their side (no package, app bundle,
      installer, browser extension or release); a web app or API you run on
      your own servers looks like this; only you can confirm it.
    - Does the intended purpose or reasonably foreseeable use include a
      direct or indirect logical or physical data connection to a device or
      network? (`data-connection-in-intended-purpose-or-foreseeable-use`)
      The code suggests yes: `public/index.html:20` and 5 more places; only
      you can confirm it.
    - Is the product supplied for distribution or use \- for example made
      available for users or customers to download, install or run on their
      own side, or sold or given away as a device (whether software that
      runs only on your own servers is a product at all is the product
      question)? (`supplied-for-distribution-or-use`)
    - Is the supply in the course of a commercial activity, whether in
      return for payment or free of charge?
      (`in-the-course-of-a-commercial-activity`)
  - 11 exemptions: a yes to one takes your product out of this law, so
    answer only one that may fit:
    - Was the product developed or modified by a public administration
      entity exclusively for its own use?
      (`public-administration-entity-own-use-only`)
    - Is the product a product with digital elements qualifying as free and
      open-source software, which its manufacturer does not monetise?
      (`free-and-open-source-not-monetised-by-its-manufacturer`)
    - Is the product a product with digital elements qualifying as a free
      and open-source software component intended for integration by other
      manufacturers into their own products with digital elements, which
      its original manufacturer does not monetise?
      (`foss-component-for-integration-not-monetised`)
    - Is your product a medical device to which Regulation (EU) 2017/745
      applies, counting software that is itself a medical device?
      (`regulation-2017-745-medical-devices-applies`)
    - Is your product an in vitro diagnostic medical device to which
      Regulation (EU) 2017/746 applies, counting software that is itself
      such a device? (`regulation-2017-746-in-vitro-diagnostics-applies`)
    - Is your product a motor vehicle or a trailer, or a system, component
      or separate technical unit intended for such a vehicle, that
      Regulation (EU) 2019/2144 applies to?
      (`regulation-2019-2144-motor-vehicles-applies`)
    - Has your product been certified in accordance with Regulation (EU)
      2018/1139, the Union's civil aviation Regulation?
      (`certified-under-regulation-2018-1139-civil-aviation`)
    - Is what you supply equipment that falls within the scope of Directive
      2014/90/EU on marine equipment?
      (`within-the-scope-of-directive-2014-90-marine-equipment`)
    - Has the Commission adopted a delegated act under Article 2(5) that
      excludes this Regulation's application to products of your kind,
      because those products are covered by other Union rules laying down
      requirements that address all or some of the risks covered by the
      essential cybersecurity requirements set out in Annex I?
      (`excluded-by-a-delegated-act-under-article-2-5`)
    - Is what you supply a spare part, made available on the market to
      replace an identical component in products with digital elements, and
      manufactured to the same specifications as the component it replaces?
      (`spare-part-replacing-an-identical-component`)
    - Was your product developed or modified exclusively for national
      security or defence purposes, or specifically designed to process
      classified information?
      (`developed-exclusively-for-national-security-or-defence`)
  - 21 more questions add detail to a finding and do not decide whether
    this law applies: `remote-processing-built-by-or-for-the-manufacturer`,
    `remote-processing-absence-would-prevent-a-function`,
    `hosting-on-an-open-repository-alone`, `price-charged-for-the-product`,
    `paid-technical-support-beyond-cost-recuperation`,
    `intention-to-monetise`,
    `personal-data-processing-required-as-a-condition-of-use`,
    `donations-exceeding-costs`,
    `donations-accepted-without-the-intention-of-making-a-profit`,
    `fee-charged-solely-to-recover-actual-operating-costs`,
    `product-is-free-and-open-source-software`,
    `component-intended-for-integration-by-other-manufacturers`,
    `component-monetised-by-its-original-manufacturer`,
    `not-for-profit-development`,
    `limited-but-not-excluded-by-a-delegated-act-under-article-2-5`,
    `information-whose-disclosure-would-be-contrary-to-national-security`,
    `placed-on-the-market-before-11-december-2027`,
    `who-the-duty-is-addressed-to`,
    `importer-or-distributor-verification-duty`,
    `open-source-software-steward`,
    `contributor-to-software-not-under-their-responsibility`
  - This version records an answer only to a question that "review my
    answers" asks; any other question here stays open, and no rule was
    switched off for an open one.

The reach of the laws below is not tested by this version (their scope
tests are still written as prose); no rule was switched off for them.

- Not assessed: ai-annex3-credit-6-4
- Not assessed: ai-annex3-education-6-4
- Not assessed: ai-annex3-emergency-6-4
- Not assessed: ai-annex3-employment-6-4
- Not assessed: data-act-jurisdiction-28
- Not assessed: data-act-switching-charges-29
- Not assessed: data-act-switching-terms-23-25
- Not assessed: dsa-contact-points-11-12
- Not assessed: dsa-legal-representative-13
- Not assessed: dsa-terms-moderation-14
- Not assessed: eaa-accessibility-statement-13-2
- Not assessed: gdpr-notice-13-14
- Not assessed: gpsr-distance-sales-19-16
- Not assessed: gpsr-online-marketplaces-22

## Questions open

- **Question for you**: May minors plausibly use the product, even if it
  does not target them? The order to fix assumes nothing about who the
  people are; your answer moves 10 findings up or leaves them where they
  are.
  Answer it for the next scan: say "review my answers" to Claude, or run
  `'<wolfboy>/product/plugin/bin/legal-scan' scan --target '.' --out '.legal/findings.json' --review-declaration`
  in a terminal.
- **To check with the organisation that runs it**: Whether the operator's
  Art. 30 record and privacy policy list Gravatar as a recipient of the
  e-mail hash (GDPR (Regulation (EU) 2016/679), Art. 30(1)(d)). This
  decides 1 finding of "Object storage, webhook or asset host that may
  receive data". The scan has no question for this yet, so it lists it
  again on every scan.

The questions the rules read that no answer gave, and the rules each holds
open:

- `audience.consumer` — not asked before this scan; your answer is used
  from the next scan (say "review my answers", or run
  `'<wolfboy>/product/plugin/bin/legal-scan' scan --target '.' --out '.legal/findings.json' --review-declaration`);
  holds open: eu-accessibility-001 (Markup, template or object-literal line
  matching a source-decidable accessibility check (EAA candidate))
- `features.genai_media` — not asked before this scan; your answer is used
  from the next scan (say "review my answers", or run
  `'<wolfboy>/product/plugin/bin/legal-scan' scan --target '.' --out '.legal/findings.json' --review-declaration`);
  holds open: ai-transparency-003 (Image-generation call or generation-host
  reference - provenance marking and AI-origin disclosure need review)
- `features.llm.present` — not asked before this scan; your answer is used
  from the next scan (say "review my answers", or run
  `'<wolfboy>/product/plugin/bin/legal-scan' scan --target '.' --out '.legal/findings.json' --review-declaration`);
  holds open: ai-inference-001 (User identity and/or document content
  forwarded to an AI-inference model endpoint - candidate recipient, Art.
  30(1)(d)); ai-inference-002 (User-identity-forwarding toggle adds
  identity headers to an inference or image-generation request);
  ai-inference-003 (Model Context Protocol tool surface that can answer a
  connecting AI client with personal data); ai-inference-005 (Model chooses
  an outbound request whose host comes from a user-created row, with the
  user's credentials); ai-transparency-001 (Language-model call, binding,
  endpoint or SDK entry point - conversational surface and AI disclosure
  need review); ai-transparency-008 (Language-model call, publishing
  surface or generated-content wording - AI-origin disclosure to readers
  needs review)
- `features.ugc` — not asked before this scan; your answer is used from the
  next scan (say "review my answers", or run
  `'<wolfboy>/product/plugin/bin/legal-scan' scan --target '.' --out '.legal/findings.json' --review-declaration`);
  holds open: eu-dsa-001 (Store a recipient could write into - who supplies
  the content and the Art. 16 notice-and-action mechanism need review);
  eu-dsa-002 (Moderation or account-restriction path - statement of reasons
  to the recipient needs review)
- `scope.data_processing_service` — not asked before this scan; your answer
  is used from the next scan (say "review my answers", or run
  `'<wolfboy>/product/plugin/bin/legal-scan' scan --target '.' --out '.legal/findings.json' --review-declaration`);
  holds open: eu-data-act-001 (Export path, or a published interface
  description - Data Act Arts. 23(c), 30(2) and 30(5) need checking)
- `scope.eaa_listed_service` — not asked before this scan; your answer is
  used from the next scan (say "review my answers", or run
  `'<wolfboy>/product/plugin/bin/legal-scan' scan --target '.' --out '.legal/findings.json' --review-declaration`);
  holds open: eu-accessibility-001 (Markup, template or object-literal line
  matching a source-decidable accessibility check (EAA candidate))

---

*This report is informational only and does not constitute legal advice. It
identifies code that may not meet a cited standard and that requires human
review; consult qualified counsel before acting on it.*
