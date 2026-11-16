/**
 * WHICH LAWS A REGION ANSWER ANSWERS.
 *
 * The region question (`scan-profile.schema.json`, `distribution_regions`' x-question) is asked once per place and its
 * No takes a rule out of review where every jurisdiction the rule declares lies within a place answered No
 * (`per-rule-applicability.ts`). Until 2026-11-11 it asked only "Is your product offered to people in {place}?", and
 * that No took out every GDPR, AI Act and ePrivacy rule, though GDPR Article 3(1) reaches an establishment in the Union
 * wherever the product is offered, Article 3(2)(b) reaches monitoring of behaviour in the Union, and AI Act Article
 * 2(1)(b) and (c) reach a deployer located in the Union and output used there (a finding of the independent check). The same class as the
 * CRA payments answer (D1): an answer used as the answer to a different, wider question.
 *
 * **The mechanism that makes the class impossible**, as `declared_answers` does for a gate limb: a region No settles a
 * rule only where the question the person answered asks the territorial test of EVERY law the rule cites. This table
 * says, law by law (by the penalty table's regime id, which is how the program already names a cite's instrument:
 * `penalty-tier.ts` `tierOfBasis`), whether the question's words carry that law's own test, and why, with the
 * provision. A law it does not carry - or one this table does not list - leaves the rule open: it is reviewed with the
 * open question attached, never set aside. A gate test (block R) fails where a regime of
 * the shipped penalty table is not listed here, and where the question's words change without this table being
 * decided again (`REGION_QUESTION_WORDS_SHA256`).
 *
 * The question was widened at the same time so that a truthful No answers as many laws as one question can: it asks
 * the widest of their tests (an office, staff or other stable presence there, or doing business there in any other
 * way; offered to people or organisations there; tracking or profiling what people there do; output of its AI used
 * there). What one question cannot carry stays open below. EU laws read 2026-11-11 from the Official Journal texts at
 * https://publications.europa.eu/resource/celex/<CELEX> (the CELEX number is in each entry).
 *
 * **The US, Japanese and Chinese laws** the bundle cites were read 2026-11-11 for their own territorial or
 * jurisdictional test (second round, next author; each entry names the provision and its official source; where the
 * official site refused an automated fetch the entry says which copy was read).
 *
 * **EACH PLACE HAS ITS OWN WORDS** (the schema's
 * `question_by_place`). Until 2026-11-12 one set of words was asked of every place, so a limb one place's laws needed was
 * asked of every place: asking whether people there use a product not offered to them would have made a US team with
 * visitors from the EU answer Yes for the EU and see GDPR as reaching it, which Art 3(2) does not, so APPI, the FTC Act and
 * Cal. Civ. Code 1798.81.5 stayed open everywhere. Now each place's words carry the tests of the laws that place's answer
 * settles (`place` below), and a law is settled only by the No of its own place's question (`regimesLeftOpen`,
 * fix-order.ts `basisAnsweredOut`). The limbs, as the schema words them:
 *
 * - presence: "your organisation has an office, staff or other stable presence there" (every place);
 * - business: "or otherwise does business there" (the US: the CCPA's business test, Cal. Civ. Code Sec. 1798.140(d)(1));
 * - offering: "it is offered to people or organisations there" (every place);
 * - tracking: "it tracks or profiles what people there do" (the EU: GDPR Art 3(2)(b));
 * - use: "people there use it, even where it is not offered to them" (the US and Japan: APPI Art 171, FTC Act limb (i),
 *   CA S.B. 243, NY GBL Art. 47, Utah H.B. 452); not asked of the EU, where it would make GDPR look reachable for a team
 *   with EU visitors, so ePrivacy Art 5(3) and Directive 2011/93 stay open there;
 * - information: "it holds personal information about people who live there" (the US: Cal. Civ. Code 1798.81.5, FTC
 *   Act limb (i));
 * - AI: "what its AI produces is used there" (the EU: AI Act Art 2(1)(c); the US: the FTC Act's limb (i); China);
 * - run: "it is run or hosted there" (Japan: APPI's reach to personal information handled in Japan; since 2026-11-12,
 *   item 8 of r12-l, no longer asked of the US, where it carried only the FTC Act, which is now open).
 *
 * **EACH ENTRY NAMES THE PARTS ITS LAW'S TEST NEEDS, AND THE PROGRAM DERIVES WHETHER A NO SETTLES IT**. Until 2026-11-12 each entry carried a
 * hand-written `carried`, and an EU No set aside the DSA, the Data Act, the European Accessibility Act and PSD2 though
 * their own tests reach a product used in the Union without being offered there, which the EU question does not ask
 * (the third check's D1: a law set aside that still reached the product). Now an entry names `needs`, the parts of a
 * region question whose No, every one of them, means the law's territorial test is not met; `regimeCarried` settles a
 * law only where every part it needs is one its place's words ask (`askedParts`, read from the schema's words through
 * `PART_WORDS`), so a law needing a part its place does not ask cannot be settled by that place's No, whatever anyone
 * writes. A part no question asks (`PART_WORDS` null) leaves its laws open everywhere. A list answered without the
 * per-place questions (no `regions_not_offered`) answers only `CLOSED_LIST_PARTS` (the third check's D5).
 *
 * A Yes to a longer question is more often true: a US Yes reaches every US rule for a team whose product people in
 * the US use, though it does no business there (the CCPA's rules are then reviewed, not set aside). That is review and
 * report noise, never a miss; what no part can carry (availability without use, whose likeness it is, conduct there
 * by others acting for the product, a test the statute does not state) stays open with its reason. Where a law needs
 * a part its place does not ask, the choice between asking it and leaving the law open is made law by law in the
 * record above, by what each costs a team that truthfully answers No.
 */
import type { Rule } from "wolfboy-schemas";
import { penaltyTableShapeProblems, tierOfBasis, type PenaltyTierTable } from "./penalty-tier.js";
import { schemaDocument } from "./schema-validate.js";

/**
 * The sha256 of each place's region question words as the schema holds them (`question_by_place`, {place} unfilled),
 * against which the table below was decided. A test recomputes them from the schema: changed words mean this table is
 * decided again.
 */
export const REGION_QUESTION_WORDS_SHA256: Readonly<Record<string, string>> = {
  EU: "a4fd3c6fa271a5c7a6811814a422acf7677221fae3e5fe3d392ded02b71b9d45",
  US: "fc72dc63c4de9ec874bd293892a07a966fa1b437e509c32fa5760e9c8aea3661",
  JP: "8320cd6ffa410e8f34f8f9a83268e1f311b1117358a2746b642c0e43efe9a156",
  CN: "4e017504ad488e0aab43b5d4ecbd139a107317a2be6fbc78693c85ac16ee32dc",
};

/** The parts a law's territorial test can turn on. */
export type QuestionPart =
  | "presence" | "business" | "offering" | "tracking" | "use" | "information" | "ai" | "run"
  | "available" | "accessed" | "conduct" | "likeness" | "transaction";

/**
 * Each part's words exactly as a place's region question holds them, or null for a part no question asks: a law that
 * needs one of those is never settled by a No. `askedParts` finds a part in a place's words by these words alone.
 */
export const PART_WORDS: Readonly<Record<QuestionPart, string | null>> = {
  presence: "your organisation has an office, staff or other stable presence there",
  business: "or otherwise does business there",
  offering: "it is offered to people or organisations there",
  tracking: "it tracks or profiles what people there do",
  use: "people there use it, even where it is not offered to them",
  information: "it holds personal information about people who live there",
  ai: "what its AI produces is used there",
  run: "it is run or hosted there",
  // Not asked anywhere; the entries that need one say why it is not asked.
  available: null, // people there could use it, whether or not anyone does
  accessed: null, // it is accessed from there
  conduct: null, // conduct material to it occurs there, done by anyone acting for it
  likeness: null, // whose name, voice or likeness it uses, wherever they live
  transaction: null, // a consumer transaction with no tie to the place
};

/**
 * What a list answered without the per-place questions answers: a profile with
 * `distribution_regions` and no `regions_not_offered` was written by hand or by the program before 2026-10-13, when the
 * only question was whether the product is made available in a place. A place it leaves out answers that part alone.
 */
export const CLOSED_LIST_PARTS: readonly QuestionPart[] = ["offering"];

/** How a place was answered No: through its own question (open world), or by being left out of a closed list. */
export type AnsweredThrough = "place-question" | "closed-list";

let askedCache: Map<string, ReadonlySet<QuestionPart>> | null = null;
/** The parts a place's own region question asks, found in the schema's words (`question_by_place`) by `PART_WORDS`. */
export function askedParts(place: string): ReadonlySet<QuestionPart> {
  if (askedCache === null) {
    askedCache = new Map();
    const doc = schemaDocument("scan-profile.schema.json") as { properties?: { distribution_regions?: { "x-question"?: { question_by_place?: Record<string, unknown> } } } };
    const byPlace = doc.properties?.distribution_regions?.["x-question"]?.question_by_place ?? {};
    for (const [code, words] of Object.entries(byPlace)) {
      if (typeof words !== "string") continue;
      askedCache.set(code, new Set((Object.keys(PART_WORDS) as QuestionPart[]).filter((k) => PART_WORDS[k] !== null && words.includes(PART_WORDS[k]!))));
    }
  }
  return askedCache.get(place) ?? new Set();
}

export interface RegionReach {
  /** The region code whose question settles this law: the No of that place's question, and of no other. */
  place: "EU" | "US" | "JP" | "CN";
  /**
   * The parts whose No, every one of them, means this law's own territorial test is not met. The law is settled by a
   * No only where its place's question asks every one of them (`regimeCarried`).
   */
  needs: readonly QuestionPart[];
  /** Why, with the provision; for a law left open, what the question does not ask. Printed in the open sentence. */
  why: string;
}

const EU_READ = "read 2026-11-12 from https://publications.europa.eu/resource/celex/";

/** By penalty-table regime id. A regime not listed here is open (the safe direction). */
export const REGION_REACH: Readonly<Record<string, RegionReach>> = {
  gdpr: { place: "EU", needs: ["presence", "offering", "tracking"], why: "GDPR Art 3(1) (an establishment in the Union, wherever the processing or the users are) is the question's presence limb, Art 3(2)(a) (offering to people in the Union) its offering limb and Art 3(2)(b) (monitoring of behaviour in the Union) its tracking limb (32016R0679)" },
  "ai-act": { place: "EU", needs: ["presence", "offering", "ai"], why: "AI Act Art 2(1)(a) (placing on the market or putting into service in the Union) is the offering and presence limbs, 2(1)(b) (a deployer established or located in the Union) the presence limb, 2(1)(c) (output used in the Union) the AI limb, and 2(1)(g) (affected persons in the Union) follows from those (32024R1689)" },
  // Open on an EU No since 2026-11-13: until then
  // `needs` was ["offering"] and the reason read Art 6's deeming as the only way ("only if"), so a truthful EU No set the CRA
  // aside for a product people in the Union download or buy without its being offered there.
  cra: { place: "EU", needs: ["offering", "use"], why: `CRA Art 2(1) reaches products with digital elements made available on the market, which Art 3(22) defines as the supply of a product for distribution or use on the Union market in the course of a commercial activity, and Art 52(1) applies Regulation (EU) 2019/1020, whose Art 6 deems a product offered online made available on the market if the offer is targeted at end users in the Union, which is the offering limb; that deeming is not the only way, and a product people in the Union download, install or buy without its being offered to them there is still supplied for use on the Union market (the Commission's Blue Guide on EU product rules 2022, section 2.4, treats delivery to end users in the Union as confirming that a product is placed on the Union market), which is use, which the EU question does not ask (${EU_READ}32024R2847 and 32019R1020; the Blue Guide from https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:52022XC0629(04), read 2026-11-13)` },
  dsa: { place: "EU", needs: ["presence", "offering", "use"], why: `DSA Art 2(1) reaches intermediary services offered to recipients established or located in the Union, and Art 3(d)-(e) make offering services in the Union enabling people there to use the service of a provider with a substantial connection to the Union: an establishment there, the targeting of activities there, or, with neither (Recital 8), a significant number of recipients in one or more Member States in relation to their population; that last is use, which the EU question does not ask, because a part asking it would make GDPR look reachable for every team with visitors from the EU (${EU_READ}32022R2065)` },
  "data-act": { place: "EU", needs: ["offering", "use"], why: `Data Act Art 1(3)(a)-(b) reach connected products placed on the market in the Union and their users there ((b) is bounded by the products of (a)), the offering limb, but Art 1(3)(f) reaches providers of data processing services, wherever established, providing such services to customers in the Union, which a customer there who signs up without being offered the service makes true; that is use, which the EU question does not ask (${EU_READ}32023R2854)` },
  eaa: { place: "EU", needs: ["offering", "use"], why: `European Accessibility Act Art 2(2) reaches services provided to consumers, and Art 3(4) makes a service provider anyone who provides a service on the Union market or makes offers to provide it to consumers in the Union; providing it to consumers there who come to it without an offer is use, which the EU question does not ask (${EU_READ}32019L0882)` },
  "geo-blocking": { place: "EU", needs: ["presence", "offering", "use"], why: `Geo-blocking Regulation Art 1 sets no territorial test of its own; Recital 17 applies it to all traders operating within the Union, established in a Member State or in a third country, in sales of goods or the provision of services within the Union, which a trader serving customers who come to it from the Union without its offering there may be doing; that is use, which the EU question does not ask (${EU_READ}32018R0302)` },
  psd2: { place: "EU", needs: ["presence", "offering", "use"], why: `PSD2 Art 2(1) applies to payment services provided within the Union, which a payment service used by people in the Union without being offered there provides; that is use, which the EU question does not ask (${EU_READ}32015L2366)` },
  "psd2-sca-rts": { place: "EU", needs: ["presence", "offering", "use"], why: "Delegated Regulation (EU) 2018/389 supplements PSD2 and takes its scope, Art 2(1) of Directive (EU) 2015/2366, which the EU question does not answer for the reason given for PSD2" },
  eidas: { place: "EU", needs: ["presence"], why: "eIDAS Art 2(1): trust service providers established in the Union, which is the presence limb (32014R0910)" },
  "e-commerce": { place: "EU", needs: ["presence"], why: "e-Commerce Directive Art 3(1): providers established on a Member State's territory, which is the presence limb (32000L0031)" },
  // Open on an EU No since 2026-11-13, for the CRA's reason: Art 2(27) has the same
  // "supply ... for distribution, consumption or use on the Union market".
  mdr: { place: "EU", needs: ["presence", "offering", "use"], why: "Medical Devices Regulation Art 1(1) reaches placing on the market, making available or putting into service in the Union, and Art 2(27) defines making available on the market as any supply of a device for distribution, consumption or use on the Union market in the course of a commercial activity, with Art 6(1)-(2) adding a device or a service offered by means of information society services to a person established in the Union, which are the offering and presence limbs; but a device people in the Union obtain and use without its being offered to them there is still supplied for use on the Union market, which is use, which the EU question does not ask (32017R0745)" },
  "tris-directive": { place: "EU", needs: [], why: "Directive (EU) 2015/1535 is cited for its definition of an information society service (Art 1(1)(b)) and lays no duty on a provider, so it adds no territorial test of its own" },
  eprivacy: { place: "EU", needs: ["presence", "offering", "use"], why: "ePrivacy Directive Art 5(3) protects the terminal equipment of any subscriber or user and the Directive sets no territorial test of its own for it (Art 3 speaks of electronic communications services); its reach is each Member State's transposing law, and the EU question does not ask whether people there use the product without its being offered to them (that limb is asked of the US and Japan, not of the EU, where it would make GDPR look reachable for a team with visitors from the EU) (32002L0058)" },
  "eprivacy-2009-136": { place: "EU", needs: ["presence", "offering", "use"], why: "Directive 2009/136/EC rewrites ePrivacy Art 5(3), which the question does not answer for the reason given for the ePrivacy Directive" },
  "csa-directive": { place: "EU", needs: ["accessed"], why: "Directive 2011/93/EU Art 17(3) reaches offences committed by means of information and communication technology accessed from a Member State's territory, whether or not it is based there, which the EU question does not ask (32011L0093)" },
  // ---- United States, Japan, China (read 2026-11-11; the record, section "Second round, next author", has each source's sha256)
  "us-ccpa": { place: "US", needs: ["business"], why: "CCPA (Cal. Civ. Code Sec. 1798.140(d)(1)): a business is one that 'does business in the State of California' (and meets a threshold), which is the US question's business limb; Sec. 1798.140(i) (consumers are California residents) and Sec. 1798.145(a)(1)(G) (conduct wholly outside California) only narrow it further (statute as posted by the California Privacy Protection Agency, https://cppa.ca.gov/regulations/pdf/ccpa_statute.pdf, January 2025 text)" },
  "us-glba": { place: "US", needs: ["presence", "business", "offering"], why: "Gramm-Leach-Bliley Act 15 U.S.C. Sec. 6801(b): standards for the financial institutions subject to the jurisdiction of the US agencies of Sec. 6805(a), for customers who obtain financial products from them (Sec. 6809(3), (9)); an institution with no presence or business in the US and not offering there is not one of them, which is the US question's presence, business and offering limbs (https://www.govinfo.gov/content/pkg/USCODE-2023-title15/html/USCODE-2023-title15-chap94-subchapI.htm)" },
  "us-ca-sb-243": { place: "US", needs: ["use"], why: "California S.B. 243 (Bus. & Prof. Code Sec. 22601): an operator 'makes a companion chatbot platform available to a user in the state', and a user is one who uses it, so the duties need someone in the state who uses it, which is the US question's use limb; Nevada A.B. 406 needs less, availability for use by any person in the state, and stays open (chaptered text, leginfo.legislature.ca.gov, read 2026-11-11 from the Internet Archive's copy of 2025-12-30 because the official site refused the fetch, HTTP 403; on 2026-11-12 the official site refused again, HTTP 403, and the archive answered HTTP 429, so the words were not re-read)" },
  "us-ny-gbl-47": { place: "US", needs: ["use"], why: "New York General Business Law Sec. 1700(8): a user is 'any person who uses an AI companion for personal use within the state', and Secs. 1701-1702 are owed to a user, which is the US question's use limb (https://www.nysenate.gov/legislation/laws/GBS/1700)" },
  "us-il-wopr": { place: "US", needs: ["offering", "use", "ai"], why: "Illinois Public Act 104-0054 Sec. 20(a): no one may 'provide, advertise, or otherwise offer therapy or psychotherapy services, including through the use of Internet-based artificial intelligence, to the public in this State', which is the US question's offering limb and, for services its AI provides, its use and AI limbs (ilga.gov, read from the Internet Archive's copy of 2026-01-08 because the official site did not answer)" },
  "us-ut-ai": { place: "US", needs: ["use", "transaction"], why: "Utah: H.B. 452's duties are owed to a 'Utah user', an individual located in Utah when using a mental health chatbot (Utah Code Sec. 13-72a-101(15)), which the US question's use limb answers; but Sec. 13-77-103(1)(a) binds a supplier whose generative AI interacts with an individual 'in connection with a consumer transaction', and neither it nor the Consumer Sales Practices Act's definitions (Sec. 13-11-3(2), (5)) set a territorial test, so whether it reaches a transaction with no tie to Utah is not settled by its words and no limb can ask it (https://le.utah.gov, read 2026-11-11)" },
  "us-nv-ab-406": { place: "US", needs: ["available"], why: "Nevada A.B. 406 Sec. 7(1)-(2): an AI provider may not 'make available for use by a person in this State' a system programmed to provide mental or behavioural health care, which reaches a system people there can use whether or not anyone there does; the US question asks whether people there use it, not whether they could, because asking that would make nearly every public product answer Yes for the US (enrolled text, leg.state.nv.us, read from the Internet Archive's copy of 2025-11-04 because the official site refused the fetch, HTTP 403)" },
  "us-ftc-act": { place: "US", needs: ["presence", "business", "offering", "use", "information", "ai", "conduct"], why: "FTC Act Sec. 5 (15 U.S.C. Sec. 45(a)(1)) reaches acts in or affecting commerce, and Sec. 45(a)(4)(A) acts involving foreign commerce that '(i) cause or are likely to cause reasonably foreseeable injury within the United States; or (ii) involve material conduct occurring within the United States'; the US question's use, information and AI limbs answer (i), and its presence and business limbs part of (ii), but (ii) does not say whose conduct, and conduct for the product in the US by a contractor, an agent or a payment or hosting provider is not asked: asking it would make most teams outside the US answer Yes for the US, since many use US payment, hosting and contracting services (https://www.govinfo.gov/content/pkg/USCODE-2023-title15/html/USCODE-2023-title15-chap2-subchapI-sec45.htm, read 2026-11-12)" },
  "us-cal-civ-1798-81-5": { place: "US", needs: ["information"], why: "Cal. Civ. Code Sec. 1798.81.5(b) binds a business that 'owns, licenses, or maintains personal information about a California resident', and Sec. 1798.80(a) makes a business one organised under the law of any country; it turns on whose information the product holds, wherever they are, which is the US question's information limb (personal information about people who live there) (leginfo.legislature.ca.gov, read from the Internet Archive's copies of 2025-12-25 and 2025-12-29 because the official site refused the fetch, HTTP 403)" },
  "us-tn-elvis": { place: "US", needs: ["likeness"], why: "Tennessee ELVIS Act: 'every individual has a property right in the use of that individual's name, photograph, voice, or likeness in any medium in any manner' (Tenn. Code Sec. 47-25-1103(a)), and Sec. 47-25-1105(a)(3) reaches whoever makes available a tool whose primary purpose is producing an individual's voice or likeness without authorisation; it turns on whose voice or likeness, not where the product reaches, which no limb of the US question can ask: 'every individual' is not limited to people who live there (Public Chapter 588 of 2024, https://publications.tnsosfiles.com/acts/113/pub/pc0588.pdf)" },
  "jp-appi": { place: "JP", needs: ["presence", "offering", "use", "run"], why: "Japan APPI Art 16(2) makes a personal information handling business operator anyone using a personal information database in business, with no territorial words, and Art 171 extends the Act to an operator handling abroad the personal information of persons in Japan 'in connection with the supply of goods or services to persons in Japan' (translated from the Japanese text); so it reaches an operator in Japan (the Japan question's presence limb), personal information handled in Japan (its run limb, since 2026-11-12: a foreign operator whose service is run or hosted in Japan handles it there), and a supply to persons in Japan, offered or used without an offer (its offering and use limbs) (https://laws.e-gov.go.jp/api/1/lawdata/415AC0000000057, read 2026-11-12)" },
  "cn-ai-labelling": { place: "CN", needs: ["presence", "offering", "ai"], why: "China's AI content labelling Measures Art 2 reach the service providers of the three regulations it names: the Generative AI Interim Measures Art 2 (services provided 'to the public within the territory of the PRC'; not applicable where none is provided to that public), and the Deep Synthesis and Algorithm Recommendation Provisions Art 2 (applying the technology within the PRC to provide internet information services); a product not offered there, run by no presence there and whose AI output is not used there does neither, which is the China question's offering, presence and AI limbs (https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm and the three regulations on www.cac.gov.cn)" },
};

/**
 * Whether a region No answers a law's territorial test: a cite that names no regime, or a regime every part of whose
 * test its place's question asks (`askedParts`), or, for a place left out of a list answered without the per-place
 * questions, `CLOSED_LIST_PARTS`. A regime this table does not list is open.
 */
export function regimeCarried(regimeId: string | undefined, through: AnsweredThrough = "place-question"): boolean {
  if (regimeId === undefined || regimeId === "") return true;
  const entry = REGION_REACH[regimeId];
  if (entry === undefined) return false;
  const asked: ReadonlySet<QuestionPart> = through === "closed-list" ? new Set(CLOSED_LIST_PARTS) : askedParts(entry.place);
  return entry.needs.every((part) => asked.has(part));
}

/**
 * The regimes of each rule's cites, registered when a bundle is loaded with its penalty table (bundle.ts `loadBundle`).
 * Keyed by the rule object the bundle holds; a rule no bundle registered (a test's hand-made rule, or a bundle without
 * a penalty table) has none, and its region answer is read by its jurisdiction alone, as before 2026-11-11.
 */
const instruments = new WeakMap<object, readonly string[]>();

/** Record, for every rule of a bundle, the regime ids its cites resolve to in that bundle's penalty table. */
export function registerInstruments(rules: readonly Rule[], table: unknown): void {
  if (penaltyTableShapeProblems(table).length > 0) return;
  const t = table as PenaltyTierTable;
  for (const rule of rules) {
    const ids = new Set<string>();
    for (const b of rule.legal_basis ?? []) {
      const j = (b as { jurisdiction?: string }).jurisdiction ?? rule.jurisdiction?.[0];
      try {
        const id = tierOfBasis(b.cite, j, t).regimeId;
        if (id) ids.add(id);
      } catch {
        // A cite the resolver cannot read names no regime here; it is not a reason to set the rule aside.
      }
    }
    instruments.set(rule, [...ids].sort());
  }
}

/** The regime ids a registered rule cites, or null where no bundle registered it. */
export function instrumentsOf(rule: Rule): readonly string[] | null {
  return instruments.get(rule) ?? null;
}

/** The place whose region question settles a regime (`REGION_REACH[id].place`), or undefined for one this table does not list. */
export function regimePlace(regimeId: string | undefined): string | undefined {
  return regimeId ? REGION_REACH[regimeId]?.place : undefined;
}

/**
 * The regimes of a rule a region No leaves open (empty where it settles all, or where none is known): one its place's
 * question does not carry, and, where `answeredNo` is given, one whose own place is not answered No (a law is settled only by the question that carries its test).
 */
export function regimesLeftOpen(rule: Rule, answeredNo?: (place: string) => boolean, through: AnsweredThrough = "place-question"): string[] {
  return (instrumentsOf(rule) ?? []).filter((id) => {
    if (!regimeCarried(id, through)) return true;
    const place = regimePlace(id);
    return answeredNo !== undefined && place !== undefined && !answeredNo(place);
  });
}

/**
 * The regimes of a rule's cites a No for `code` would set aside: those whose place
 * is `code` and whose place's question carries them. Empty where no bundle registered the rule.
 */
export function regimesSettledBy(rule: Rule, code: string): string[] {
  return (instrumentsOf(rule) ?? []).filter((id) => regimePlace(id) === code && regimeCarried(id));
}

/** The sentence part naming why a region No does not settle a rule: each open law with its reason. */
export function leftOpenWhy(ids: readonly string[]): string {
  return ids.map((id) => REGION_REACH[id]?.why ?? `${id}: its own territorial test has not been read against the question, so the answer does not settle it`).join("; ");
}
