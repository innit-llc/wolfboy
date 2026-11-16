/**
 * Direction-B census — enumerating what the code actually does.
 *
 * Pillar 2 has two directions, and only one of them can start from the document. Direction A reads
 * a claim and looks for what would falsify it. **Direction B cannot**: what a document fails to say
 * is not searchable from the document, so the search space is the whole tree again — which is
 * pillar 1's constraint, and gets pillar 1's answer. This module is layer 1 for direction B.
 *
 * The difference from pillar 1's detectors is what they emit. A rule surfaces a *suspicion* of a
 * violation. These collectors emit *facts*: where data goes, what is collected, when it is deleted,
 * in which region it is processed. Nothing here decides whether a fact involves personal data or
 * whether the declaration covers it — that is layer 2's judgement, and putting it here would be
 * building a classifier nobody can audit into the part of the system that is supposed to be
 * deterministic.
 *
 * Two consequences of that, both binding:
 *
 * - **No filtering.** Every hit is emitted. A namespace URI that is not a request, a hostname in a
 *   comment-free constant that is never called — all of it goes to the agent, which dismisses what
 *   it should. Reading too much produces candidates that are visible, countable and fixable;
 *   reading too little produces nothing and the tool says "no problems found".
 * - **One deliberate exception, and it is not a filter.** A dependency with no call site is not
 *   reported as a fact, because it is not one. `@sendgrid/mail` sits in the owner's `package.json`
 *   and is called from nowhere; reporting SendGrid as a recipient of personal data would have been
 *   a false accusation about a real company. Those packages are still emitted — in
 *   `declared_only_dependencies`, where they are visible and countable — because "we looked and
 *   found no call site" is a different statement from silence.
 *
 * The engine cannot be reused for this. `runBuiltin` records `re.test()` booleans and a line of
 * text; a census needs the captured value — the hostname, the package name, the region string — so
 * every collector here runs `exec()` with capture groups over its own pass.
 *
 * Matching runs against comment-stripped content (`contentForGuards`), so a commented-out call is
 * not reported as a fact the application performs. The reported `line_text` comes from the original
 * file, so what the reader sees is what is written there.
 */

import { createHash } from "node:crypto";
import { valueFreeText } from "./credential-redaction.js";
import { productPrintedRedaction } from "./product-redaction.js";
import type {
  CensusCallSite,
  CensusCategory,
  CensusFact,
  CensusResult,
  DeclaredOnlyDependency,
  DependencyEcosystem,
  DependencyInventoryEntry,
  DependencyManifestBlock,
  ManifestNotUsable,
  CensusStoppedFile,
  CensusLongLinesFile,
  CallSitesNotRead,
  OutboundHostFileWithoutRequestConstruct,
} from "wolfboy-schemas";
import { commentView } from "./strip-comments.js";
import { blankLongLines, decodedTextIsBinary, isNonProductionPath, MINIFIED_LINE_LIMIT } from "./walk.js";

export type {
  CensusCallSite,
  CensusCategory,
  CensusFact,
  CensusResult,
  DeclaredOnlyDependency,
  DependencyInventoryEntry,
};

/**
 * **Nothing in this file is gated on an extension any more, and this list is kept as a COST LABEL.**
 *
 * Until 2026-09-03 it was `applies: (ext) => CODE_EXTS.has(ext)` on four collectors and half of a
 * fifth, and on the import pass — the last extension judgement left in the product after the
 * discovery ruling of 2026-09-02. It decided, from a file's name alone, that a `.tf`, a `.sh`, a
 * `.sql`, a `.dart`, a `.m`, a `.lua`, a `.c` or a `.yml` performs no outbound call, runs no
 * scheduled deletion and names no processing region. The third real pillar-2 run made the cost
 * concrete on a Swift/SwiftPM tree; the class was already recorded three times in `walk.ts` and once
 * in `discover.ts`, each time with the same conclusion.
 *
 * **No branch in this file reads it.** It is kept, and kept exported, as a published label — a
 * caller that wants to describe a tree's format mix has one name for "source-shaped" instead of
 * writing its own list, which is how the 2026-08-04 duplicate-boundary defect started. The format
 * mix a run actually reports is `discovery.looked_at.extensions`, and a second copy of it here would
 * be forbidden.
 */
export const CODE_EXTS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "vue", "svelte", "astro",
  "py", "rb", "go", "php", "java", "kt", "kts", "cs", "swift", "rs", "ex", "exs", "scala",
]);

/**
 * Anything that renders a document and can therefore carry a third-party `src`/`href`. **Read by
 * nothing since 2026-09-03, exactly as `CODE_EXTS` is** — the `external-tags` collector's real
 * discriminator is the tag construct itself (`<script … src="https://…">`), which is a fact about
 * the line, and that test now runs over every readable file. Kept, unexported, as the record of what
 * the gate was: deleting it would leave the collector's own history unreadable, and exporting it
 * would publish a surface nothing asked for.
 */
const MARKUP_EXTS = new Set([
  "html", "htm", "tsx", "jsx", "vue", "svelte", "astro", "php", "erb",
  "hbs", "ejs", "njk", "liquid", "twig", "blade", "haml", "slim", "jinja", "j2",
]);

/**
 * Hosts that appear in source as *identifiers*, not as destinations.
 *
 * `"@context": "https://schema.org"` in JSON-LD and `xmlns="http://www.w3.org/2000/svg"` in an SVG
 * are names for a vocabulary. Nothing is fetched, nobody receives anything, and calling them
 * recipients of personal data is not a precision cost — it is the collector being wrong about what
 * it is looking for, which is the one thing that may be corrected at any time
 * (its own worked example is "XML namespace URIs as HTTP requests"). The first agent run counted
 * 62 of these among the outbound hosts of one application.
 *
 * They are counted in `stats.identifiers_not_requests` rather than dropped in silence, on the same
 * principle as `declared_only_dependencies`: a suppression nobody can count is a suppression nobody
 * can check. Deliberately a short list of standards vocabularies, not a list of hosts that seem
 * uninteresting — the second kind of list would be narrowing, and is not permitted.
 */
const IDENTIFIER_HOSTS = new Set([
  "schema.org", "www.w3.org", "w3.org", "purl.org", "xmlns.com", "schemas.xmlsoap.org",
  "docs.oasis-open.org", "www.docbook.org", "docbook.org", "ns.adobe.com", "iptc.org",
  "www.iptc.org", "creativecommons.org", "www.opengis.net", "openoffice.org",
]);

/**
 * Top-level names a hostname can end in.
 *
 * The bare-host pattern has no `https://` to key on, so something has to say what a hostname *is*.
 * Without this, `"adv.aiBadge"` and `"admin.role.change"` are hostnames: measured on one real
 * application, the pattern produced **2,996 facts of which roughly 20 were hosts** — the rest were
 * translation keys and dotted property paths. That is not a precision cost to be evaluated later,
 * it is the pattern being wrong about what it is looking for, which is the one thing the project's rules
 * permit correcting at any time.
 *
 * Reserved top-level names (RFC 2606, RFC 6761) are included deliberately: `.test`, `.example`,
 * `.local` and `.invalid` are what documentation, fixtures and internal services actually use, and
 * an internal service is a recipient like any other.
 *
 * A hostname under a TLD not listed here is missed. That is a real limit, recorded rather than
 * hidden, and it is the cheap direction to be wrong in only because the same host almost always
 * also appears with a scheme somewhere.
 */
const HOST_TLDS = new Set([
  // reserved and internal
  "test", "example", "local", "invalid", "localhost", "internal", "lan", "home", "arpa",
  // the ones a codebase actually reaches
  "com", "net", "org", "io", "co", "ai", "dev", "app", "cloud", "sh", "gg", "so", "to", "me",
  "info", "biz", "xyz", "tech", "site", "online", "store", "run", "page", "link", "live", "tv",
  "gov", "edu", "mil", "int", "eu", "asia",
  // country codes seen in vendor and regional endpoints
  "jp", "us", "uk", "de", "fr", "es", "it", "nl", "be", "ch", "at", "se", "no", "dk", "fi", "pl",
  "cz", "pt", "gr", "ie", "ru", "ua", "tr", "il", "ae", "sa", "in", "cn", "hk", "tw", "kr", "sg",
  "my", "th", "vn", "id", "ph", "au", "nz", "ca", "mx", "br", "ar", "cl", "za", "ng", "ke",
]);

const ENV_PATTERNS = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*['"]([^'"]+)['"]\s*\]/g,
  /os\.environ(?:\.get\(|\[)\s*['"]([^'"]+)['"]/g,
  /ENV\[\s*['"]([^'"]+)['"]\s*\]/g,
];

/**
 * A dotted string handed to a translation function is a key, not a host.
 *
 * The bare-host shape exists to reach `aiplatform.googleapis.com`, a hostname with no scheme. It
 * also matches `t("nationalities.uk")` and `t("context.tr")`, because `uk` and `tr` are real
 * top-level names — measured on one real application, which produced `home.interface.online`,
 * `residences.uk` and `course.scene.net` as recipients of personal data.
 *
 * **A translation key is not a hostname by any reading**, so this is the collector being wrong
 * about what it is looking for rather than paying for breadth, and the project's rules permit correcting
 * that at any time. The test is the call the string sits in, which is a fact about the code and not
 * a guess about whether the value looks interesting.
 */
const TRANSLATION_CALL = /(?:\$?t|i18n\.t|intl\.\w+|translate|__|formatMessage|useTranslation|getTranslation|trans)\s*\(\s*\{?\s*(?:id\s*:\s*)?$/;

/**
 * A quoted string immediately followed by `:` is a property name.
 *
 * This is where the translation keys actually live — not in `t("nationalities.uk")` but in the
 * dictionary itself, `"nationalities.uk": "British",`. **A property name is not a destination**:
 * it names a slot, and nothing is sent to it. A configuration map genuinely keyed by hostname loses
 * nothing either, because a host the application contacts appears with a scheme somewhere else, and
 * that occurrence is still emitted.
 */
function isPropertyName(line: string, startIndex: number, endIndex: number): boolean {
  // A trailing `:` is not enough. `cond ? "models.example-ai.test" : other` has one too, and the
  // first version of this check deleted that host from the fixture — a real destination, silently.
  // The fixture caught it, which is the whole reason the fixture exists. A property name also has
  // to *start* an expression: it follows `{`, a comma, or the beginning of the line.
  if (!/^\s*:/.test(line.slice(endIndex))) return false;
  return /(^|[{,])\s*$/.test(line.slice(0, startIndex));
}

/**
 * A quoted string inside `[...]` is a property accessor, and a string assigned to a field whose
 * name ends in `key` is a key by the code's own account.
 *
 * `content?.["home.interface.online"]` and `i18nKey: 'course.scene.net'` are the two remaining
 * shapes a translation key takes in real source once the dictionary literal is handled. Neither is
 * a destination: the first names a slot to read, the second names a slot to look up later. Both
 * tests are about the syntax the string sits in, which is a fact, rather than about whether the
 * value looks interesting, which would be a guess.
 */
function isLookupKey(line: string, startIndex: number, endIndex: number): boolean {
  if (/\[\s*$/.test(line.slice(0, startIndex)) && /^\s*\]/.test(line.slice(endIndex))) return true;
  return /(?:key|id|slug|name|token|code)\s*:\s*$/i.test(line.slice(0, startIndex));
}

function precededByTranslationCall(line: string, index: number): boolean {
  return TRANSLATION_CALL.test(line.slice(0, index));
}

function extensionOf(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * `kind` is part of the identity, not decoration.
 *
 * One line can produce two facts from one collector: `fetch("https://x/y")` matches both the
 * call-shaped pattern and the literal-shaped pattern, so the same host on the same line is emitted
 * once as `outbound_call` and once as `url_literal`. Without `kind` in the hash those two share an
 * identifier, and anything that builds a map keyed on `fact_id` — the annotator, a report citing
 * `fact_refs`, a reader deduplicating — silently keeps one and drops the other. Found by the
 * fixture specification, which enumerated three such pairs before any golden was generated.
 */
function factId(collector: string, kind: string, file: string, line: number, value: string): string {
  // Over the value's value-free form: the id is
  // written where others may read it, and a digest of a captured value holding a guessable credential (a URL's password)
  // could be reversed by hashing candidates. Unchanged for a value with nothing to redact.
  const free = valueFreeText(productPrintedRedaction(), value);
  return `cf_${createHash("sha256").update(`${collector}|${kind}|${file}|${line}|${free}`).digest("hex").slice(0, 16)}`;
}

function envOnLine(line: string): string[] {
  const found = new Set<string>();
  for (const re of ENV_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) found.add(m[1]);
  }
  return [...found];
}

/**
 * A line collector. **It has no file surface of its own, and that is the point.**
 *
 * Until 2026-09-03 every entry carried `applies: (ext) => CODE_EXTS.has(ext)` or its markup
 * equivalent, and that predicate is exactly the question `walk.ts` and `discover.ts` have both
 * already been made to stop asking: *"is this extension one we recognise?"*. Its failure mode is the
 * one this repository has now recorded four times — a format nobody thought of is invisible, to
 * every collector at once, and the output says nothing rather than saying too much. Measured on the
 * third real pillar-2 run (a Swift/SwiftPM tree): a Terraform region literal, a shell
 * script's release command, a `.sql` deletion path and a `.dart`, `.m`, `.lua` or `.kt` outbound host
 * produced no fact for that reason alone.
 *
 * **What decides now** is the collector's own construct check — a hostname must end in a real
 * top-level name and not be a translation key, a scheduled job must be a CALL, a permission API must
 * be `navigator.<name>`, an external tag must be a tag with a `src`. Those tests are about what the
 * line says, they were always the real discriminator, and they are unchanged. What is removed is the
 * layer in front of them that answered from the file's name.
 *
 * Owner ruling, 2026-09-03, extending the 2026-09-02 ruling ("the extension does not matter") from discovery to the
 * census. What survives an extension test anywhere in this file is (a) physical readability, which is
 * a statement about bytes, and (b) a documentary/executable distinction that is now measured from the
 * text and keeps the extension list only as a fallback that can agree and never override — see
 * `isDocumentaryFile`.
 */
interface LineCollector {
  name: string;
  kind: string | ((m: RegExpExecArray) => string);
  categories: CensusCategory[];
  patterns: RegExp[];
  /** Which capture group carries the value. */
  value: (m: RegExpExecArray) => string | null;
}

/**
 * A billing call site, in the spellings the walker actually reads.
 *
 * **Why this exists: the one deciding kind could only read JavaScript.** From 2026-07-30
 * `subscription_route` was the single fact kind allowed to settle
 * `in-the-course-of-a-commercial-activity`, the limb that closes the CRA applicability gate. It was
 * produced by two patterns, both shaped on the Stripe **Node** SDK and both case-sensitive, so
 * every other spelling of the identical call was invisible to the verdict. Measured on the pinned
 * corpus 2026-08-03, all MISS before this list existed:
 *
 *   - a Rails help-desk application ships `enterprise/app/services/enterprise/billing/` — `Stripe::Subscription.create`,
 *     `Stripe::BillingPortal::Session.create`, `Stripe::Invoice.create`, `Stripe::Subscription.update`
 *     — and returned `likely-applies`.
 *   - a Python tree ships a subscription router calling `stripe.Subscription.modify(...)`
 *     and returned `likely-applies`.
 *   - a Ruby tree ships a subscriptions plugin calling `::Stripe::Subscription.create(...)`
 *     and the first commercial evidence a reader was shown was a **2012 password-column
 *     migration**.
 *   - a TypeScript tree ships a Stripe manager calling `stripe.billingPortal.sessions.create(...)`
 *     and `stripe.subscriptions.cancel(...)`, the Node SDK's own casing, and its drop to
 *     `likely-applies` had been recorded as the demotion working correctly.
 *
 * **This is a correction, not a widening for its own sake.** The rule was wrong about what a
 * subscription call looks like: it believed the call had one spelling. Reading too little produces
 * nothing and the tool says "no problems found", which is the invisible direction. Nothing was
 * tightened to pay for it.
 *
 * There is no language allowlist anywhere in the scanner — `walk.ts` reads a file unless its bytes
 * are not text or it is machine-generated — and the pinned corpus deliberately contains large Ruby
 * on Rails applications beside the Node and Python ones. A billing
 * directory the walker reads and the collector cannot name is indistinguishable, in the output,
 * from a repository that has none.
 *
 * **Every pattern here is anchored on the vendor**, either by containing the vendor's name in the
 * match or by requiring it on the same line (`BILLING_CALL_NEEDS_VENDOR`). That is what keeps the
 * kind at the standard set for a deciding fact: a line a
 * reader opens and confirms in one second. `Stripe::Subscription.create(` passes that test in any
 * language; a bare `subscriptions.create` or a React hook called `useBillingPortal` does not, and
 * neither is here.
 */
const BILLING_CALL_BODIES = [
  // (1) A vendor-namespaced resource, called. One body covers five languages because they differ
  //     only in the separator and the case of the receiver:
  //       Ruby    `Stripe::Subscription.create(`, `::Stripe::BillingPortal::Session.create(`
  //       Python  `stripe.Subscription.modify(`, `stripe.checkout.Session.create(`,
  //               `stripe.billing_portal.Session.create(`, `stripe.Webhook.construct_event(`
  //       PHP     `\Stripe\Subscription::create(`, `\Stripe\Checkout\Session::create(`
  //       Java    `com.stripe.model.Subscription.create(`
  //       C#      `Stripe.BillingPortal.SessionService` is reached through (4) instead
  //     `new` is deliberately NOT a verb here: `Stripe::APIError.new('stripe unavailable')` in a
  //     help-desk application's spec is an error object, not a call to a payment provider.
  String.raw`[Ss]tripe(?:::|\\|\.)(?:[A-Za-z_]+(?:::|\\|\.)){0,2}[A-Z][A-Za-z]*(?:::|\.)(?:create|modify|update|cancel|retrieve|list|search|del|delete|construct_event|constructEvent|Create|Modify|Update|Cancel|Retrieve|List|Delete)`,
  // (2) The Node SDK's own casing, reached through a receiver literally called `stripe`. The two
  //     patterns beside this list read `checkout.sessions.create` and a vendor-guarded
  //     `subscriptions.create`; they do not read `stripe.billingPortal.sessions.create`,
  //     `stripe.subscriptions.cancel`, `stripe.subscriptionSchedules.create` or
  //     `stripe.invoices.create`, which are the same SDK and the same operation.
  //     The negative lookahead keeps this body off the three chains the older patterns already
  //     read. Without it one call site produced two `subscription_route` facts of the same kind on
  //     the same line, differing only in whether the value carried the `stripe.` receiver — one
  //     fact printed as two, which is the "one fact in two places" defect this repository hunts,
  //     arriving from the direction of a widening. Measured on `shipped-mini`
  //     (`stripe.checkout.sessions.create`) and on one unpublished application
  //     (`stripe.paymentIntents.create`, two lines).
  String.raw`[Ss]tripe\.(?!(?:[a-zA-Z]+\.)?(?:checkout\.sessions\.create|paymentIntents\.create|subscriptions\.create)\b)(?:[a-zA-Z]+\.)?(?:subscriptions|subscriptionItems|subscriptionSchedules|invoices|invoiceItems|paymentIntents|checkout|billingPortal|billing_portal|sessions|prices|plans|charges|coupons|promotionCodes|customers|webhooks)\.(?:create|update|cancel|retrieve|list|search|del|createPreview|constructEvent)`,
  // (3) PHP's arrow form on a client literally called `stripe`:
  //     `$stripe->checkout->sessions->create([`, `$stripe->subscriptions->cancel(`.
  String.raw`[Ss]tripe(?:Client)?->(?:[a-zA-Z_]+->){0,2}(?:create|update|cancel|retrieve|all)`,
  // (4) Go's `&stripe.SubscriptionParams{` — the vendor is inside the symbol.
  String.raw`[Ss]tripe\.(?:Subscription|SubscriptionItem|SubscriptionSchedule|CheckoutSession|BillingPortalSession|PaymentIntent|Invoice|InvoiceItem)Params`,
];

/**
 * Bodies whose text is ordinary English and which therefore carry two extra conditions.
 *
 * Java's `SubscriptionCreateParams`, C#'s `SubscriptionCreateOptions` and `new SessionService(`,
 * and Go's `subscription.New(` are all real spellings of the call — and all four are also names
 * somebody could give a class of their own. So a match here is a call site only where **a payment
 * vendor is named on the same line** (the device the `subscriptions.create` pattern already used
 * for Rails ActionCable) **and the symbol is constructed or invoked rather than merely named**.
 *
 * The second condition is why `mode: Stripe.Checkout.SessionCreateParams.Mode;` in one tree's
 * `organization-payments` DTO is not a `subscription_route`: it is a TypeScript type annotation,
 * and this kind means a billing call site everywhere else in the gate. Calling a type annotation a
 * call site would make the kind's own definition false, which is the "is this the thing at all?"
 * question and not a false-positive rate. The line is still collected, as `commercial_documented`.
 */
const BILLING_CALL_BODIES_NEEDING_VENDOR = [
  String.raw`(?:Subscription|SubscriptionItem|SubscriptionSchedule|Session|PaymentIntent|Invoice)(?:Create|Update|Cancel)(?:Params|Options)`,
  String.raw`(?:Subscription|SubscriptionItem|SubscriptionSchedule|Session|PaymentIntent|Invoice|BillingPortal\.Session)Service`,
  String.raw`(?:subscription|sub|billingportalsession|checkoutsession|paymentintent|invoice)\.New`,
];

const BILLING_CALL_SITES: RegExp[] = [
  ...BILLING_CALL_BODIES.map((b) => new RegExp(String.raw`\b(${b})\s*[(\s{]`, "g")),
  ...BILLING_CALL_BODIES_NEEDING_VENDOR.map((b) => new RegExp(String.raw`\b(${b})\b`, "g")),
];

/**
 * The same bodies, anchored and NOT global, for classifying a captured value.
 *
 * Separate objects on purpose: `commercialKind` runs inside the collector's own
 * `while (re.exec(line))` loop, so touching a pattern the loop is iterating would reset its
 * `lastIndex` and either skip matches or hang the scan.
 */
const BILLING_CALL_VALUE = new RegExp(`^(?:${[...BILLING_CALL_BODIES, ...BILLING_CALL_BODIES_NEEDING_VENDOR].join("|")})$`);
const BILLING_CALL_VALUE_NEEDS_VENDOR = new RegExp(`^(?:${BILLING_CALL_BODIES_NEEDING_VENDOR.join("|")})$`);

/** Every pattern the census builds at load time rather than writes as a literal, for the cost gate (`lint:clause-cost` (H)). */
export const CENSUS_BUILT_PATTERNS: readonly RegExp[] = [...BILLING_CALL_SITES, BILLING_CALL_VALUE, BILLING_CALL_VALUE_NEEDS_VENDOR];

/** Does this line name a payment vendor at all? */
const PAYMENT_VENDOR_ON_LINE = /stripe|paddle|braintree|chargebee|recurly|lemonsqueezy|razorpay|revenuecat/i;

/**
 * The seven collectors.
 *
 * Each pattern captures. Where a collector has more than one pattern, the patterns are different
 * *shapes of the same fact* rather than different facts: a hostname reached through `fetch(...)`
 * and a hostname sitting in a `const OPENAI_URL = "https://api.openai.com/..."` are both "this
 * application knows this host", and the trial found the second shape more often than the first.
 */
/**
 * The AI Act Annex III use-case vocabulary, exported so that the measurement script and the product
 * read THE SAME STRINGS.
 *
 * **This export is the fix for a defect that recurred three times in one day, each time in the same
 * place.** The shapes below were measured two ways — loud on the one real product each area was
 * validated against, quiet on the 27 repositories that are none of them — and then retyped into the
 * collector. Each retyping lost something, and each loss was invisible until somebody re-measured:
 *
 *   1. A trailing `\b` was added where the measurement had none. Every clause ends in truncated
 *      stems (`Scor`, `Categor`, `Evaluat`), and `scor\b` never matches `score`. **One
 *      pure applicant-tracking system, produced zero facts.** Self-caught.
 *   2. A leading `\b` was added to the four hiring and credit clauses where the measurement had no
 *      left anchor. `\b` fails wherever the entity noun follows a word character — which is every
 *      compound where it is not the first token, the dominant convention in `snake_case` and
 *      prefixed `camelCase`. **About a quarter of one tree's lines lost, and nearly all of the second
 *      hiring shape.**
 *   3. The token `order` was dropped from the job/vacancy clause. **One applicant-tracking tree names its vacancy
 *      entity `joborder` throughout: every one of those lines matched by the measured shape, none by the shipped
 *      one — 100% of that shape.** Same check.
 *
 * A constant duplicated across a boundary and kept in sync by hand is a defect with a delay fuse;
 * `clause-cover` records the same lesson about the walker's file-extension set, and
 * `test-reconcile` about the census-category list. Both were fixed by importing rather than copying.
 * an internal record now imports this array, so a number published from a measurement is a
 * number about the regex the product actually ships.
 *
 * **Stems, not full words**. `hired` cannot reach
 * `candidateHiring`; `rating` cannot reach `candidateRated`; `origination` cannot reach
 * `loanOriginator`, and a lending tree writes `loan_originators` throughout. Each is written as the stem.
 */
export const PURPOSE_PATTERNS: RegExp[] = [
  // Hiring and worker management — Annex III pt 4. No left anchor, as measured: the entity noun is
  // routinely preceded by a word character (`employeeCandidateScore`, `cj_job_application_uid`).
  /(?:[Cc]andidate|CANDIDATE|[Aa]pplicant|APPLICANT|[Rr]esume|RESUME|[Aa]pplication|APPLICATION)s?[_-]?(?:[Rr]at|RAT|[Ss]cor|SCOR|[Rr]ank|RANK|[Ss]creen|SCREEN|[Ss]hortlist|SHORTLIST|[Ff]eedback|FEEDBACK|[Ee]valuat|EVALUAT|[Cc]riteri|CRITERI|[Aa]ssess|ASSESS|[Mm]atch|MATCH|[Ff]it|FIT|[Rr]eject|REJECT|[Hh]ir|HIR|[Qq]ualit|QUALIT|[Ss]kill|SKILL|[Ii]nterview|INTERVIEW|[Pp]ars|PARS|[Ff]ilter|FILTER)\w*/g,
  // `order` restored. An applicant-tracking tree calls a vacancy a `joborder`, and without it the shape reached none
  // of that product's 1,879 matching lines.
  /(?:[Jj]ob|JOB|[Vv]acancy|VACANCY|[Pp]osting|POSTING)[_-]?(?:[Aa]pplicant|APPLICANT|[Aa]pplication|APPLICATION|[Cc]andidate|CANDIDATE|[Oo]rder|ORDER)\w*/g,
  // `applicant tracking` — the most on-the-nose string an ATS can contain. **The 25-lines-on-2/2
  // figure this comment carried until 2026-08-04 was measured before the instrument agreed with the
  // product**: on the shipped file surface it is a handful of lines on one tree and none on another, whose two
  // occurrences are both in `README.md`. Kept anyway — a string this specific is worth collecting
  // where it appears in code — but the justification is the specificity, not that count.
  /[Aa]pplicant[_\- ][Tt]racking|APPLICANT[_-]TRACKING/g,
  // Education and assessment — Annex III pt 3. The left guard is mandatory and is a lookbehind
  // rather than `\b`: `upgrade`, `downgrade` and `retrograde` all contain `grade`, and `upgradelib`
  // alone occurs hundreds of times in one learning platform. Found by reading that tree, not by reasoning about the word.
  /(?<![A-Za-z])(?:[Gg]radebook|GRADEBOOK|[Gg]rade[_-]?(?:[Ii]tem|ITEM|[Gg]rade|GRADE|[Cc]ategor|CATEGOR|[Ss]cale|SCALE|[Bb]ook|BOOK|[Mm]ax|MAX|[Mm]in|MIN|[Pp]ass|PASS|[Mm]ethod|METHOD|[Ll]etter|LETTER|[Rr]eport|REPORT)|[Gg]rading[_-]?(?:[Ff]orm|FORM|[Ss]cale|SCALE|[Mm]ethod|METHOD|[Rr]ubric|RUBRIC|[Gg]uide|GUIDE|[Gg]rade|GRADE)|[Mm]arking[_-]?[Gg]uide)\w*/g,
  // Qualifier-first grades, which the entity-first shape cannot reach: `finalgrade` (hundreds in one learning platform),
  // `maxgrade`, `rawgrade`, `sumgrades`. Enumerated rather than wildcarded so `upgrade` stays out.
  /(?<![A-Za-z])(?:[Ff]inal|FINAL|[Mm]ax|MAX|[Rr]aw|RAW|[Ss]um|SUM|[Ll]etter|LETTER|[Oo]verall|OVERALL|[Aa]uto|AUTO)[_-]?[Gg]rade\w*/g,
  /(?<![A-Za-z])(?:[Aa]ssessment|ASSESSMENT|[Ee]xam|EXAM|[Qq]uiz|QUIZ)[_-]?(?:[Gg]rad|GRAD|[Ss]cor|SCOR|[Aa]ttempt|ATTEMPT|[Rr]esult|RESULT|[Ss]ubmi|SUBMI|[Aa]ccess|ACCESS)\w*/g,
  // Annex III pt 3(b) is "to evaluate learning outcomes" in its own words, and no shape reached the
  // concept: `outcome`, `outcomes` and `outcomeid` occur over a thousand times in one learning platform and produced nothing.
  // Qualified rather than bare, because `outcome` alone is ordinary English.
  /(?<![A-Za-z])(?:[Ll]earning|LEARNING|[Cc]ourse|COURSE|[Aa]ssessment|ASSESSMENT|[Ss]tudent|STUDENT)[_-]?[Oo]utcome\w*/g,
  // Annex III pt 3(d) — "monitoring and detecting prohibited behaviour of students during tests".
  // It matched a few lines on one learning platform and none elsewhere, a clean signal, and was dropped for
  // being quiet. Quiet is not the same as wrong.
  /(?<![A-Za-z])(?:[Pp]roctor|PROCTOR|[Ii]nvigilat|INVIGILAT)\w*/g,
  // Credit and insurance — Annex III pt 5(b),(c). `credit + qualifier` is the noisiest of these
  // shapes, and it is kept because pt 5(b) names credit scoring in those exact words; the noise is
  // stated in ai-annex3-credit-6-4's own corpus-honesty note rather than hidden.
  /(?<![A-Za-z])(?:[Cc]reditworthi|CREDITWORTHI|[Uu]nderwrit|UNDERWRIT|CREDIT[_-]?(?:SCOR|RAT|RISK|DECISION|CHECK|BUREAU|LIMIT)|[Cc]redit[_-]?(?:[Ss]cor|SCOR|[Rr]at|RAT|[Rr]isk|RISK|[Dd]ecision|DECISION|[Cc]heck|CHECK|[Bb]ureau|BUREAU|[Ll]imit|LIMIT))\w*/g,
  /(?<![A-Za-z])(?:[Ll]oan|LOAN|[Mm]ortgage|MORTGAGE)[_-]?(?:[Aa]pprov|APPROV|[Dd]ecision|DECISION|[Ss]cor|SCOR|[Rr]isk|RISK|[Aa]pplic|APPLIC|[Oo]riginat|ORIGINAT|[Dd]elinquen|DELINQUEN)\w*/g,
];

/**
 * The patterns that say a build, CI or manifest step GENERATES a software bill of materials.
 *
 * **Held outside the collector because two places consult them.** The `sbom-generation` line
 * collector below is one; the `package.json` probe in `DISTRIBUTION_PROBES` is the other, and it
 * exists because the dependency branch of `runCensus` returns before the collector loop, so a
 * manifest reaches no line collector at all. A manifest and a shell script name the same tools, and
 * two lists that had to agree would drift — this repository has paid for that shape before.
 *
 * **Case-insensitive throughout, from 2026-08-05.** An independent check measured `Syft`,
 * `Trivy sbom` and `CDXgen` all missed, because four of the five patterns were `/g` and only the
 * output-format line was `/gi`. A command is written however its author typed it.
 */
const SBOM_GENERATION_PATTERNS: RegExp[] = [
  // Generators, by the name they are invoked or depended on under. `syft` is deliberately absent
  // and has its own pattern below.
  /\b(cyclonedx-npm|cyclonedx-py|cyclonedx-python|cyclonedx-bom|cyclonedx-gomod|cyclonedx-cli|cyclonedx-gradle-plugin|cyclonedx-maven-plugin|spdx-sbom-generator|sbom-tool|cdxgen)\b/gi,
  // **`syft` needs a command around it, and alone of these names it does.** PySyft is a mainstream
  // federated-learning library imported as `syft`, so the bare name is also an ordinary module
  // specifier. Measured 2026-08-05 by an independent check: `import syft as sy` and
  // `from syft.core.node import Node` produced one generation-step fact per import line, and every
  // file of such a repository claimed a bill of materials was being produced.
  //
  // So the name is required to sit where something is RUN: at the start of a shell or recipe line,
  // after a shell separator, inside a command substitution or backticks, opening a JSON script
  // string, or after a `run:`/`RUN`/`cmd`/`npx`-shaped keyword — and to be followed by an argument.
  // An import specifier fails both halves: nothing that begins a command precedes it, and a quote,
  // a dot or a comma follows it rather than a subcommand or a flag. This is the "is this the thing
  // at all?" correction, not a false-positive trim: an import statement is not a build step.
  /(?:^[\s>$*+\-]*|[;&|]\s*|\$\(\s*|`\s*|["']|\b(?:run|entrypoint|cmd|args|npx|bunx|sudo|exec)\s*[:=]?\s+)(syft)\b(?=\s+(?:-|[A-Za-z0-9]))/gim,
  // The published container image, which is how `syft` is invoked when it is not installed. Kept
  // separate from the command-position pattern because `docker run --rm anchore/syft:latest` puts
  // the name in an argument position, not a command one.
  /\b(anchore\/syft)\b/gi,
  // Subcommands of a general tool that name the artefact themselves.
  /\b((?:trivy|docker|npm|dotnet|bom)\s+sbom)\b/gi,
  // Published CI actions whose whole purpose is to produce one.
  /\b(anchore\/sbom-action|CycloneDX\/gh-node-module-generatebom|CycloneDX\/gh-python-generate-sbom|CycloneDX\/gh-gradle-generate-sbom|advanced-security\/generate-sbom|microsoft\/sbom-tool|actions\/dependency-submission)\b/gi,
  // The CycloneDX packages, which are what a manifest or a lockfile-free build script names.
  /(@cyclonedx\/[A-Za-z0-9.\-_]+)/gi,
  // The output-format line that makes a scanner step emit a bill of materials. **A space counts as
  // a separator as well as `:` and `=`, from 2026-08-05**: `trivy fs --format cyclonedx` is the
  // commonest CLI spelling of this step there is, and the `[:=]` form matched none of it.
  /\b(?:format|output-format|outputFormat|sbom-format)(?:\s*[:=]\s*|\s+)["']?(cyclonedx[a-z0-9-]*|spdx[a-z0-9-]*)\b/gi,
];

/* ------------------------------------------------------------------------- *
 * The outbound-host corroboration pass — an annotation, never a filter (2026-09-02).
 * ------------------------------------------------------------------------- *
 *
 * **The hole this closes** (hole 3 of the first real-repository pillar-2 run). The two loose
 * outbound-host patterns — a URL literal in a quoted string, and a bare dotted hostname in quotes —
 * exist for good measured reasons and reach real recipients nothing else reaches. They also reach
 * every hostname anybody ever typed into a string. On one personal-finance tree they gave a couple of hundred rows over as many
 * distinct hostnames, of which roughly 170 come from three files with no network code in them at
 * all — a static comparison table listing *other companies'* personal-finance tools
 * (`www.tesla.com` is a row in a Tesla-employee-finance listing, not a Tesla integration), a
 * "featured on" logo carousel, and a unit-test spec's fixture data. Those rows then made up most of
 * the 319 and 322 "supporting facts" behind two CRA scope-gate limbs, where a reader taking the
 * count as a measure of evidence strength is reading noise as signal inside a legal-scope verdict.
 *
 * **Why this is an annotation and not a narrowing.** When target-correctness is at issue,
 * add a confirming path, never remove the loose one — subtraction is the only operation that can
 * create a miss. A bare hostname in a quoted string is exactly the shape that reached
 * `aiplatform.googleapis.com`, a CSP `connect-src` allowance and every host whose scheme is added
 * elsewhere. So no row is dropped, no row moves out of `facts`, and no verdict changes. What is
 * added is the same discipline `declared_only_dependencies` already carries for the other
 * collector with this problem: **a package with no call site is not a recipient, and a hostname in
 * a file with no request construct is not one either until somebody finds the call site.**
 *
 * **What the flag means, exactly.** It is a statement about the FILE, not about the program: a host
 * whose request is assembled two modules away is listed and is still a real recipient. It is a
 * reason to look before naming a company, never a reason to drop.
 */
const REQUEST_CONSTRUCTS: RegExp[] = [
  // The JavaScript and TypeScript clients, including the ones the collector's own first pattern
  // names, plus the node/browser primitives that carry a host built elsewhere.
  //
  // **A client's name is required to be CALLED or IMPORTED, never merely written.** `got`, `ky`,
  // `fetch` and `requests` are all ordinary English words as well as client names, and a bare-word
  // match on any of them reads a sentence in a comment as a network call — which would make this
  // annotation quietly stop naming the files it exists to name. The direction of that error is the
  // silent one: a file wrongly credited with a call site is a file this list never mentions.
  /\b(?:fetch|axios|got|ky|superagent|undici|request|http[Cc]lient)\s*(?:\.\s*\w+\s*)?\(/,
  /\b(?:axios|superagent|undici|node-fetch|got|ky)\b(?=[^\n]*\bfrom\b|[^\n]*\brequire\s*\()/,
  /\b(?:XMLHttpRequest|EventSource|WebSocket|WebSocketServer)\b/,
  /\$\.(?:ajax|get|post|getJSON)\b/,
  /\b(?:https?|http2)\.(?:get|request|createServer)\b/,
  // `new Request|WebSocket|EventSource(` open a connection; `new URL|URLSearchParams|Headers(`
  // construct VALUES and were dropped (LOW 3) — a comparison table rendering its own links with
  // `new URL(tool.site)` is exactly the file this annotation exists to name, and crediting it with
  // a request construct left it un-annotated.
  /\bnew\s+(?:Request|WebSocket|EventSource)\s*\(/,
  /\bnavigator\.sendBeacon\b/,
  /\bimport\s*\(\s*[`'"]https?:/,
  // Python.
  /\b(?:requests|httpx|aiohttp|urllib3?|websockets)\s*\.\s*\w+\s*\(/,
  /\b(?:import|from)\s+(?:requests|httpx|aiohttp|urllib|urllib2|urllib3|websockets)\b/,
  /\burlopen\s*\(/,
  // JVM, .NET, Go, Ruby, PHP, Rust, shells and clients.
  /\b(?:HttpClient|HttpURLConnection|OkHttpClient|RestTemplate|WebClient|HttpRequest|HttpWebRequest)\b/,
  /\bhttp\.(?:Get|Post|NewRequest|Client|DefaultClient)\b/,
  /\bNet::HTTP\b|\bFaraday\b|\bRestClient\b|\bHTTParty\b/,
  /\b(?:curl_init|file_get_contents|Guzzle|GuzzleHttp)\b/,
  /\breqwest\b|\bhyper::\b/,
  /\b(?:curl|wget)\s+(?:-|https?:)/,
  // A declared network destination that is not a call: a Content-Security-Policy directive, a proxy
  // pass, a base or webhook URL setting. **Included on purpose**: these are places a hostname is a
  // real statement about where this product talks to, and a reader must not be told to go and find
  // a call site that by construction does not exist.
  //
  // **Compound, URL-naming keys only, and this was measured before it was written.** The first draft
  // of this line matched a bare `proxy|target|origin|endpoint` followed by `:` or `=`, and on
  // one personal-finance tree that read `origin: 'XX'` — the country a personal-finance tool comes from, in the
  // static marketing table this whole annotation exists to name — as a declared network destination,
  // so the single largest file of non-recipients was the one file it failed to flag. A key that
  // names a network destination says so in the key.
  // Both spellings of a Content-Security-Policy directive: the header's own hyphenated form, and
  // the camelCase key every library that builds the header for you takes (`helmet`'s
  // `contentSecurityPolicy: { directives: { connectSrc: [...] } }` is how one tree declares its
  // Stripe allowance, and the hyphenated pattern alone read that file as having no destination).
  /\b(?:connect|script|img|frame|default|font|media|style|form-action|frame-ancestors)-src\b/,
  /\b(?:connectSrc|scriptSrc|imgSrc|frameSrc|defaultSrc|fontSrc|mediaSrc|styleSrc|formAction|frameAncestors)\b/,
  /\bcontent[_-]?security[_-]?policy\b/i,
  // URL-naming keys only. `hostname` was dropped (LOW 3): it is generic — `hostname: "localhost"`, a
  // database host, a row in a data table — so a bare `hostname:` credited files that declare no HTTP
  // destination, the silent direction. The keys kept each name an HTTP endpoint in the key itself,
  // and a file that declares a destination only through a bare `hostname:` is now annotated as one
  // to look at rather than silently credited with a call site it does not have.
  /\b(?:base[_-]?url|api[_-]?url|service[_-]?url|webhook[_-]?url|callback[_-]?url|redirect[_-]?uri|proxy[_-]?(?:pass|url|target|host)|upstream)\b\s*[:=]/i,
];

/** Paths that read as a test, a spec, a mock or a fixture, where a hostname is sample data. */
const TEST_OR_FIXTURE_PATH =
  /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?|specs?|fixtures?|testdata|mocks?|e2e|cypress)\/|\.(?:spec|test)\.[A-Za-z0-9]+$|(?:^|\/)conftest\.py$|_test\.[A-Za-z0-9]+$/i;

/** Does this file carry anything that could send a request, or declare a network destination? */
export function fileCarriesRequestConstruct(text: string): boolean {
  return requestConstructOrSpent(text, () => false) === true;
}

/** The same question with the file's clock read before each construct (each is a whole-file test): null when the budget is spent first. */
function requestConstructOrSpent(text: string, spent: () => boolean): boolean | null {
  for (const re of REQUEST_CONSTRUCTS) {
    if (spent()) return null;
    if (re.test(text)) return true;
  }
  return false;
}

/** Does this path read as a test, spec, mock or fixture file? */
export function isTestOrFixturePath(path: string): boolean {
  return TEST_OR_FIXTURE_PATH.test(path);
}

const COLLECTORS: LineCollector[] = [
  {
    name: "outbound-hosts",
    kind: (m) =>
      !/(?:https?|wss?):\/\//.test(m[0])
        ? "host_literal"
        : /^[`'"]/.test(m[0])
          ? "url_literal"
          : "outbound_call",
    categories: ["recipients"],
    patterns: [
      // `wss:` is in every scheme alternation below, and it is not a nicety. Measured on a real
      // application: an agent reported that the census could not see
      // `wss://api.openai.com/v1/realtime`, and wrote that **a silence check built only from census
      // facts would have missed the largest transfer that application makes** — a live audio stream
      // of a phone call to a third party. A WebSocket is an outbound transfer by any reading, and
      // the collector was blind to the whole scheme. This is the expensive direction of being
      // wrong: the fact never reaches the agent, so nothing appears at all.
      /\b(?:fetch|axios(?:\.(?:get|post|put|patch|delete|request|head))?|got(?:\.\w+)?|ky(?:\.\w+)?|superagent(?:\.\w+)?|request|urlopen|HttpClient|WebSocket|connect|websockets\.connect)\s*\(\s*[`'"](?:https?|wss?):\/\/([A-Za-z0-9.\-_]+(?::\d+)?)/g,
      /[`'"](?:https?|wss?):\/\/([A-Za-z0-9\-_]+(?:\.[A-Za-z0-9\-_]+)+(?::\d+)?)[/`'"?#]/g,
      // A host whose subdomain is interpolated: `https://${SERVICE_ID}.microcms.io/api/v1/blogs`.
      // The registrable part is still a recipient, and the trial's weakest finding was exactly
      // this shape — missed by the two patterns above, which both need a literal first character
      // after the scheme. A host held *entirely* in a variable (`${BASE_URL}/x`) remains out of
      // reach of any deterministic pass and is recorded as a limit rather than papered over.
      /[`'"](?:https?|wss?):\/\/\$\{[^}]*\}((?:\.[A-Za-z0-9\-_]+)+)/g,
      // A hostname held in a quoted string with no scheme, because the scheme is added elsewhere:
      //   const host = region === 'global' ? 'aiplatform.googleapis.com' : `${region}-aiplatform…`
      // The first agent run reported this host as a recipient it had to find by hand, because the
      // census produced no fact of any kind for it. Missing a real recipient is the expensive
      // direction: an extra candidate is dismissed in one line, an absent one is never seen.
      /[`'"]((?:[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?\.){1,}[A-Za-z]{2,24})[`'"]/g,
    ],
    value: (m) => m[1] ?? null,
  },
  {
    name: "external-tags",
    kind: (m) => `external_${(m[1] ?? "tag").toLowerCase()}`,
    categories: ["recipients"],
    patterns: [
      /<(script|link|iframe|img|source|video|audio|embed|object)\b[^>]*?\b(?:src|href|data)\s*=\s*[{]?\s*[`'"](?:https?:)?\/\/([A-Za-z0-9.\-_]+)/gi,
    ],
    value: (m) => m[2] ?? null,
  },
  {
    /**
     * Sensitive-capability access, in the two vocabularies the platforms actually use.
     *
     * **The Apple half was added 2026-09-03, and the gap it closes was total.** Every pattern here
     * was a Web API, so the third real pillar-2 run measured this collector at exactly ZERO facts on
     * an iOS application that asks for the camera, the photo library, Face ID and notifications —
     * and the run's own store-declaration comparison had to record "not comparable, and not
     * attempted" against the manifests' `NSPrivacyAccessedAPICategory` entries, because there was
     * nothing on the code side to compare them with. A zero from a collector that cannot see the
     * platform is a statement about the collector, and the asymmetry this project works by says that is the
     * expensive direction: the fact never reaches the agent, so nothing appears at all.
     *
     * **What decides which KIND a hit is, stated exactly, because the first version of this comment
     * claimed more than the patterns hold** (independent verification, 2026-09-03, MODERATE 1... see
     * `permissionKind`). Three of the patterns below carry a construct in the pattern itself
     * (`AVCaptureDevice.requestAccess`, `UNUserNotificationCenter.current().requestAuthorization`,
     * `ATTrackingManager.requestTrackingAuthorization`), two carry a call (`LAContext(`,
     * `.evaluatePolicy(`), one is a key inside a plist (`NS…UsageDescription`) — and **seven are a
     * BARE CLASS NAME** (`CLLocationManager`, `CNContactStore`, `EKEventStore`, `HKHealthStore`,
     * `SFSpeechRecognizer`, `CMMotionActivityManager`, `CBCentralManager`). A bare name matches a
     * sentence as readily as a statement: `The app historically used CLLocationManager but no longer
     * does.` in a README, and `"help.contacts": "We use CNContactStore to read your address book"` in
     * a localisation catalogue, both produced `ios_permission_requested_*` — a kind whose word
     * asserts a runtime request over evidence that says the opposite. With the extension gate gone
     * those files are read, so the bare names now reach them.
     *
     * The repair is this file's own convention, used twice already
     * (`release_automation`/`release_documented`, `subscription_route`/`commercial_documented`):
     * **the hit is emitted either way and the kind says which of the two it is.**
     * `ios_permission_documented_*` is a bare name in a sentence — in a document by extension, or in
     * any file where the name is not used as a symbol. Nothing is dropped, no pattern is narrowed,
     * and no gate limb consults any `ios_permission_*` kind, so no verdict can move either way.
     *
     * **Two constructs, because iOS declares a permission in two places and both are real.** The
     * `Info.plist` usage-description key is the DECLARATION Apple requires before the system will
     * even show the prompt — it is the closest thing the platform has to a manifest of what an app
     * asks for, and it is exactly what a privacy manifest's claims are checked against. The runtime
     * call is the REQUEST. Neither implies the other: a key with no call site is a capability
     * declared and not used, a call with no key does not ship. Both are emitted, and telling them
     * apart is the `kind` field's job.
     *
     * The shapes below are the ones a real iOS tree writes (these lines are made up): an `Info.plist`
     * key `<key>NSCameraUsageDescription</key>`, a camera service's
     * `AVCaptureDevice.requestAccess(for: .video)`, and a notification service's
     * `UNUserNotificationCenter.current().requestAuthorization`.
     *
     * **Android is still unreached, and that is recorded rather than left to be discovered from a
     * zero**: `<uses-permission android:name="android.permission.CAMERA"/>` and
     * `ActivityCompat.requestPermissions` produce no fact here. This wave was briefed on iOS.
     */
    name: "permission-apis",
    kind: (m) => permissionKind(m),
    categories: ["collection"],
    patterns: [
      /\bnavigator\.(geolocation|mediaDevices|clipboard|permissions|bluetooth|usb|serial|hid|contacts|credentials|storage|share|wakeLock)\b/g,
      /\b(Notification|DeviceMotionEvent|DeviceOrientationEvent)\.requestPermission\b/g,
      /\b(getUserMedia|getDisplayMedia|watchPosition|getCurrentPosition)\s*\(/g,
      // The Info.plist usage-description key. The capture is the capability itself, so
      // `NSCameraUsageDescription` and `NSCameraUsageDescription` in two targets are one value with
      // two locations rather than two values. `NSPrivacy…` keys are deliberately NOT matched here:
      // those are the privacy MANIFEST's own fields, `store-declarations.ts` parses them as the
      // declaration under test, and collecting them as code facts would make the document its own
      // corroboration.
      /\bNS(?!Privacy)([A-Za-z]+?)UsageDescription\b/g,
      // The runtime request, by the framework class that issues it.
      /\b(AVCaptureDevice)\.requestAccess\b/g,
      /\b(PHPhotoLibrary|PHPhotoLibrary\.shared\(\))\.requestAuthorization\b/g,
      /\b(CLLocationManager)\b/g,
      /\.(requestWhenInUseAuthorization|requestAlwaysAuthorization)\s*\(/g,
      /\b(UNUserNotificationCenter)\.current\(\)\.requestAuthorization\b/g,
      /\b(ATTrackingManager)\.requestTrackingAuthorization\b/g,
      // THE BARE NAMES. Kept bare on purpose — a class an application only stores in a property
      // (`private let store: CNContactStore`) writes the name and nothing else, and requiring a
      // trailing `(` would lose exactly that. `permissionKind` reads the line around the match and
      // says whether the name is used as a symbol or written in a sentence; it never declines a hit.
      /\b(CNContactStore|EKEventStore|HKHealthStore|SFSpeechRecognizer|CMMotionActivityManager|CBCentralManager)\b/g,
      // Biometric evaluation. `LAContext` is the class an app builds to ask for Face ID or Touch ID,
      // and `evaluatePolicy` is the call that prompts. Both are collected: an iOS tree builds
      // seven `LAContext()`s and declares `NSFaceIDUsageDescription` in three targets.
      /\b(LAContext)\s*\(/g,
      /\.(evaluatePolicy)\s*\(/g,
    ],
    value: (m) => m[1] ?? null,
  },
  {
    name: "scheduled-jobs",
    kind: (m) => (/delete|destroy|truncate|cleanup|purge|prune|DELETE/i.test(m[0]) ? "deletion_path" : "scheduler"),
    categories: ["retention"],
    patterns: [
      /\b(cron\.schedule|new\s+CronJob|scheduleJob|setInterval|@Cron|schedule\.every|celery\.schedule)\b/g,
      /\b(schedule[A-Z][A-Za-z0-9_]*)\s*\(/g,
      /\b((?:cleanup|purge|prune|expire|delete)[A-Z][A-Za-z0-9_]*|deleteMany|destroyAll|truncate)\s*\(/g,
      /\b(DELETE\s+FROM)\b/gi,
    ],
    value: (m) => m[1] ?? null,
  },
  {
    name: "region-constants",
    kind: (m) => (m[0].includes("process.env") || m[0].includes("os.environ") ? "region_env_default" : "region_literal"),
    categories: ["transfers"],
    patterns: [
      // The shape that decides where processing happens when nobody sets the variable. The trial
      // found `process.env.GEMINI_LOCATION || 'global'` in two files of an application whose
      // privacy policy says the data stays on servers in Japan.
      /process\.env\.[A-Z0-9_]*(?:REGION|LOCATION|ZONE)[A-Z0-9_]*\s*(?:\|\||\?\?)\s*['"]([^'"]+)['"]/g,
      /['"]((?:asia|us|europe|australia|northamerica|southamerica|me|africa)-[a-z]+\d+)['"]/g,
      /['"]((?:ap|us|eu|sa|ca|me|af|il|cn)-(?:north|south|east|west|central|northeast|northwest|southeast|southwest)-\d)['"]/g,
    ],
    value: (m) => m[1] ?? null,
  },
  {
    // ---------------------------------------------------------------------------------------
    // Distribution, the line-shaped half. The manifest-shaped half is DISTRIBUTION_PROBES below;
    // both emit `collector: "distribution"` because they are two shapes of one fact.
    //
    // What this collector is for. CRA Article 2(1) reaches a product with digital elements
    // "made available on the market", and Article 3(22) defines that as "the supply of a product
    // with digital elements for distribution or use ... in the course of a commercial activity".
    // Until this collector existed, nothing in the census reported whether the tree supplies
    // anything at all, and the applicability gate of `cra-product-information-13-8` said so in
    // terms: "No collector reports a published package, a release artefact, an installer, a store
    // bundle or a browser-installable client, so that limb is read from the tree by hand."
    // Reading a limb by hand is how the 2026-07-29 gate defects happened.
    //
    // **A container build IS evidence here, and it was not until 2026-07-29.** The earlier version
    // of this collector refused to emit it, on the stated ground that CRA Recital 12 routes a
    // service its provider hosts itself out of the Regulation and into NIS2. **That reading of
    // Recital 12 is wrong.** An independent legal pass reported it and the Official Journal text
    // settles it: what Recital 12 places outside is "cloud services designed and developed
    // **outside the responsibility of a manufacturer** of a product with digital elements" — a
    // manufacturer's own backend is inside, which is also what Article 3(1) says in terms.
    //
    // So the exclusion rested on a misreading, and an exclusion whose justification has failed is
    // not kept. Owner decision, 2026-07-29: emit it. The two shapes are told apart by kind rather
    // than by dropping one — `container_build_config` for a build, `release_automation` for a push
    // to a registry, which is supply to somebody else — and which of them matters is the reader's
    // question, not this collector's.
    name: "distribution",
    kind: (m) =>
      /serviceWorker|workbox|vite-plugin-pwa|next-pwa|VitePWA|manifest\.webmanifest/i.test(m[0])
        ? "installable_web_client"
        : "release_automation",
    categories: ["distribution"],
    // Every text file, not only source. A release step lives in a CI workflow, a Makefile or a
    // shell script as often as in code, and the walker is a denylist for the same reason. This
    // collector never had an extension gate; since 2026-09-03 none of them has.
    // Documentation counts too, but not as the same fact — see `isDocumentaryFile`.
    patterns: [
      // An installable web client: the browser keeps it on the device and launches it like an
      // app. This is the shape the 2026-07-29 decidability pass found the CRA gate blind to —
      // the gate listed no form of distribution that arrives through a browser, and the first
      // real project it was pointed at was exactly that.
      /\b(navigator\.serviceWorker\.register|workbox|VitePWA|vite-plugin-pwa|next-pwa)\b/g,
      // A build or release step that hands the artefact to someone else. Matched as commands and
      // as the published GitHub Actions that wrap them, because most repositories use the action.
      /\b(npm\s+publish|pnpm\s+publish|yarn\s+publish|cargo\s+publish|twine\s+upload|gem\s+push|mvn\s+deploy|goreleaser|docker\s+push)\b/g,
      /\b(gh\s+release\s+create|softprops\/action-gh-release|pypa\/gh-action-pypi-publish|docker\/build-push-action|ncipollo\/release-action)\b/g,
      // Editor and IDE marketplaces. **None of these was matched until 2026-07-29**, and an
      // independent pass found the miss on the most obvious possible tree: one tree publishes with
      // `vsce publish` and `ovsx publish` across four workflows and ships a JetBrains plugin, and
      // was caught only incidentally by an npm `bin` entry and by two Tauri configs that live
      // under `apps/examples/` and are sample code rather than the product. For a scanner whose
      // stated audience is developers, an editor extension is close to the commonest shape there
      // is, and it was invisible.
      /\b(vsce\s+publish|ovsx\s+publish|publishPlugin|xcrun\s+altool|xcodebuild\s+-exportArchive)\b/g,
      /\b(eas\s+(?:build|submit)|fastlane\s+\w+|flutter\s+build\s+(?:appbundle|apk|ipa)|electron-builder|tauri\s+build)\b/g,
    ],
    value: (m) => m[1] ?? null,
  },
  {
    // ---------------------------------------------------------------------------------------
    // A build or CI step that GENERATES a software bill of materials. The artefact-shaped half is
    // the `sbom_artifact` probe in DISTRIBUTION_PROBES below; both are `distribution` facts,
    // because a bill of materials is release evidence and that is where release evidence lives.
    //
    // What this collector is for. CRA Annex I Part II point (1) requires a manufacturer to
    // "identify and document vulnerabilities and components contained in products with digital
    // elements, including by drawing up a software bill of materials in a commonly used and
    // machine-readable format covering at the very least the top-level dependencies of the
    // products". The checklist that asks it is `rules/checklists/cra-sbom-annex-i-ii-1.yaml`.
    //
    // **What this fact may and may not be read as, stated here because the direction is asymmetric.**
    // A hit is evidence FOR a record being produced and a reader can open the line and confirm it.
    // The ABSENCE of a hit says nothing at all: Recital 77 states manufacturers "should not be
    // obliged to make the SBOM public", so the record may be generated in a pipeline this scan never
    // sees, held in an artefact store, or drawn up outside the repository. Nothing here may be wired
    // to a limb of the CRA scope gate, and `KIND_POWER` in a test pins that.
    //
    // Named tools and actions only, never the words "sbom" or "bill of materials" on their own: the
    // second would match every README that mentions the subject and every issue template, which is
    // vocabulary and not a step. The one non-tool pattern is the output-format line, because
    // `format: cyclonedx` is what turns a general scanner step into one that emits a bill of
    // materials, and the scanner's own name does not say which it is doing — `aquasecurity/trivy-action`
    // is a vulnerability scan by default and is deliberately NOT matched by name for that reason.
    // `trivy sbom` and `docker sbom` are matched, because there the subcommand says it.
    //
    // Not a lockfile collector, and cannot become one here. `walk.ts` denylists all fourteen common
    // lockfiles, the census only sees what the walker hands it, and the coverage map's "lockfile
    // present = generatable in one step" signal is therefore unreachable without a change to the
    // walker. The checklist's `scope_note` records that gap rather than working around it.
    //
    // **This collector never sees a `package.json`**, and the pattern list's own comment about "what
    // a manifest names" used to imply it did. The dependency branch of `runCensus` returns before
    // the collector loop, so the manifest half of the signal is carried by a probe in
    // `DISTRIBUTION_PROBES` that runs the same patterns — `SBOM_GENERATION_PATTERNS`, shared rather
    // than copied — over a manifest before that branch runs.
    name: "sbom-generation",
    // A plain string, not `() => "sbom_generation_step"`. It was the only constant kind in the file
    // written as a zero-argument function — legal per the `string | ((m) => string)` union and with
    // no functional effect, but it now has to read the same way as the `package.json` probe below,
    // which declares the identical kind.
    kind: "sbom_generation_step",
    categories: ["distribution"],
    // Every text file, for the same reason the distribution collector above says: a generation step
    // lives in a CI workflow, a Makefile, an npm script or a shell script as often as in code.
    patterns: SBOM_GENERATION_PATTERNS,
    value: (m) => m[1] ?? null,
  },
  {
    // ---------------------------------------------------------------------------------------
    // Commercial activity — CRA Article 3(22)'s third element, characterised by Recital 15.
    //
    // Added 2026-07-29 after three verification passes found the same thing from three
    // directions: the applicability verdict `applies` was unreachable, because the
    // commercial-activity limb is required and no collector emitted a single fact bearing on it.
    //
    // **The kinds are split by what a reader can check, not by what the value says.** That
    // division was decided on 2026-07-29, after the same defect appeared on
    // three separate trees:
    //
    //   - an MIT component library with no payment code reached the gate's strongest
    //     verdict on three copies of the word "stripe" — from a **striped progress bar**'s JSDoc.
    //   - an MIT React framework reached it on a PayPal hyperlink in a tutorial blog post,
    //     the sentence "Revenue is in Stripe. Users are in your database.", and 34 `price_list_id:
    //     null` rows in a recorded mock of somebody else's e-commerce API.
    //   - another component library reached it on a PayPal donation link, while its genuine paid-SLA purchase
    //     links sorted below.
    //
    // The product's two-layer doctrine — layer 1 casts wide, layer 2 judges — was being applied to
    // findings and not to the verdict: raw collector output was reaching the instrument's strongest
    // conclusion with nothing in between.
    //
    // **The deciding set was narrowed to one kind on 2026-07-30**. The 2026-07-29
    // split by "what a reader can check" left three kinds able to settle the limb that closes the
    // gate, and an independent check then measured the result on twelve previously unscanned
    // repositories: 6 of the 8 `applies` verdicts were decided by evidence that does not bear on
    // Article 3(22) at all — an SVG icon import, a markdown filename, a third-party API host, and a
    // Content-Security-Policy header inside a recorded test fixture. Two of those three kinds had
    // therefore not earned the power. So:
    //
    //   `subscription_route`    a billing call site              — DECIDES; a call site, and the
    //                                                             one kind that survived every
    //                                                             attack of 2026-07-30
    //   `payment_provider`      a vendor used in code            — annotates only (from 2026-07-30)
    //   `hosted_checkout_link`  a purchase URL (buy.stripe.com)  — annotates only (from 2026-07-30)
    //   `price_identifier`      an identifier name               — annotates only
    //   `licence_key_check`     an identifier name               — annotates only
    //   `commercial_documented` a vendor named in prose, a
    //                           non-payment link, or a vendor
    //                           name a line mentions rather
    //                           than uses                        — annotates only
    //   `donation_link`         a donation route                 — annotates only; Recital 15's
    //                           last sentence puts donations
    //                           taken without profit outside
    //   `monetary_amount_literal` a bare number                  — annotates only
    //
    // **This is a demotion in deciding power and never a suppression.** Nothing is dropped: every
    // hit is still emitted, still carried into the assessment, and still shown to the reader on the
    // characterisation limbs. What a demoted fact may no longer do is settle, by itself, the limb
    // whose answer produces the instrument's strongest verdict.
    //
    // **That sentence was false of the code between 2026-07-30 and 2026-08-03, and the correction
    // is in `scope.ts`, not here.** The demotion held on a scan with no profile and was reversed on
    // a scan with one: a declaration of `features.payments.present = false` turned any commercial
    // fact into `contradicted-by-declaration`, and that state was counted as settled whatever it
    // held, so a `donation_link` in a static-site framework and a `monetary_amount_literal` inside `index.mock.ts`
    // in the React framework each produced `applies` by themselves. The evaluator now settles the limb from
    // `code_evidence.supports` on both paths, so the sentence above is true of the code again.
    //
    // **`subscription_route` reads six languages from 2026-08-03, not one.** See
    // `BILLING_CALL_SITES` above: while the kind was the only one able to decide, it could only see
    // the Stripe Node SDK's spelling, so a Ruby billing directory, a Python
    // subscription router, a Ruby subscriptions plugin and a TypeScript tree's own
    // `billingPortal.sessions.create` were all invisible to the verdict.
    //
    // What this collector still does NOT decide: every one of Recital 15's five characterisations
    // ends in a judgement — whether a support fee exceeds cost recovery, whether a donation is
    // taken with an intention to profit, whether personal data is required for reasons beyond
    // security and interoperability. The artefact is emitted; the judgement stays with the reader.
    name: "commercial-signals",
    kind: (m) => commercialKind(m),
    categories: ["commercial"],
    patterns: [
      // A vendor name beside a dot or a parenthesis. **The pattern stays wide on purpose and
      // `commercialKind` decides what the hit is**: whether the dot begins a member access that is
      // used, a file extension, a sentence, or a domain is a question about the rest of the line,
      // and a pattern that answered it by matching less would stop collecting the hits a reader
      // wants to see. `\.\w` with no whitespace is kept because a full stop that begins a new
      // sentence has a space after it, and `. Users` was reaching the verdict.
      /\b(stripe|Stripe|paddle|Paddle|lemonsqueezy|LemonSqueezy|braintree|razorpay|chargebee|recurly|revenuecat|RevenueCat|Purchases|StoreKit|BillingClient|paypal|PayPal)\s*(?:\.\w|\()/g,
      // A billing call site. `subscriptions.create` is deliberately absent from the bare list and
      // is matched only with a vendor on the same line: Rails ActionCable's client uses the
      // identical chain (`this.consumer.subscriptions.create(` in one tree) and so does another tree's
      // notification API, and neither is money.
      /\b(checkout\.sessions\.create|billing_?portal|createPaymentIntent|paymentIntents\.create)\b/g,
      /\b(subscriptions\.create)\b(?=.*(?:stripe|Stripe|billing|Billing|paddle|invoice))/g,
      // The same call, in the other spellings the walker actually reads. See `BILLING_CALL_SITES`
      // below for why these are here and what was missed while they were not.
      ...BILLING_CALL_SITES,
      // A URL on a payment vendor's domain. The two wildcard alternatives match every subdomain a
      // vendor has, which is deliberate — the hit is worth showing either way — and `PURCHASE_URL`
      // in `commercialKind` is what decides whether the URL is a purchase route
      // (`hosted_checkout_link`) or merely a vendor host (`commercial_documented`). The comment
      // here used to claim the clause matched "the payment route itself"; it did not, and
      // `api.lemonsqueezy.com` was reaching the limb that closes the gate.
      //
      // **The subdomain was mandatory on the two wildcard hosts until 2026-07-30, so the plainest
      // purchase link either vendor issues was collected by nothing.** `https://gumroad.com/l/x` is
      // Gumroad's own product-purchase URL and it has no subdomain; `[a-z0-9-]+\.gumroad\.com`
      // required one, so the line produced no commercial fact at all — silence, which is the
      // direction this repository's rules forbid. Found by running the collector over a constructed
      // line on 2026-07-30, not by reading. Both subdomains are now optional.
      //
      // **The subdomain starts only where a run of its characters starts, or right after
      // a previous match's host.** Read from every position of a long run of `[a-z0-9-]`, the
      // subdomain read that run to its end each time: 7 s on one 1,000,000-byte file of hostile
      // 4,990-character lines, in a pass no file budget meters. A start inside a run can only find a
      // match the run's own start already found, since both end at the same `.`, and the scan
      // reaches a run's start first; the one place it does not is a run that begins inside the
      // previous match (`...lemonsqueezy.com-shop.lemonsqueezy.com`), which the second look-behind
      // admits. Same matches, same spans, same captures.
      /(?:https?:\/\/)?((?:buy|checkout)\.stripe\.com|pay\.paddle\.com|(?:(?:(?<![a-z0-9-])|(?<=(?:stripe|paddle|lemonsqueezy|gumroad)\.com))[a-z0-9-]+\.)?lemonsqueezy\.com|(?:www\.)?gumroad\.com)\b/gi,
      // A price, plan or subscription identifier the billing system uses.
      /\b(unit_amount|STRIPE_PRICE[A-Z_]*|price[_A-Za-z]*[Ii]d|stripe[_A-Za-z]*[Pp]rice|subscription[_A-Za-z]*[Ii]d)\b/g,
      // A bare number assigned to a price-shaped name. The weakest kind in the collector: 186 of
      // these were mock prices in a documentation gallery on one repository.
      /\b(amount|price|total|subtotal)\s*[:=]\s*(\d{2,})/g,
      // A licence-key check. No trailing `\b`: the commonest spelling is `validateLicenseKey`,
      // where the word continues and a boundary never arrives.
      /(validateLicen[cs]e\w*|\blicen[cs]e[_-]?key\w*|\bactivation[_-]?key\w*)/gi,
      // Donation routes.
      /(?:https?:\/\/)?(?:www\.)?(github\.com\/sponsors|opencollective\.com|ko-fi\.com|buymeacoffee\.com|patreon\.com|liberapay\.com|paypal\.me|paypal\.com\/(?:donate|paypalme)|donate\.stripe\.com|tidelift\.com|thanks\.dev)\b/gi,
    ],
    value: (m) => m[1] ?? null,
  },
  {
    // The `purpose` category exists for exactly this collector: what the product is FOR, not what
    // data it holds or who it talks to. Added 2026-08-04 for the three ai-annex3-*-6-4 checklists.
    //
    // **This collector decides nothing.** Every one of the three duties it feeds is settled by
    // `features.annex_iii_use` in the scan profile — the person running the scan — never by this
    // fact. `candidate_id` in a tree does not make the product an applicant-tracking system, and an
    // applicant-tracking system need not contain it. A source-code classifier for "is this a
    // hiring, education or lending product" was designed, measured and discarded on 2026-08-04 by
    // decision, on the ground that the question is not answerable from source vocabulary at
    // all; the rule it rests on is stated in the project's rules
    // and in its decision log under that date.
    name: "purpose-signals",
    // Every token the patterns can emit is named here, and nothing else is. The first version ended
    // in a `purpose_other` catch-all (hundreds on one lending tree alone, because the credit test named only
    // `loan|mortgage|underwrit` and the pattern that fired was `credit_score`); the second named
    // four tokens — `underwrit`, `student`, `proctor`, `admission` — that no pattern could emit, so
    // the dispatcher documented an intent the patterns did not carry and a reader could conclude
    // underwriting was covered when it was not.
    kind: (m) =>
      /credit|loan|mortgage|underwrit/i.test(m[0])
        ? "purpose_credit"
        : /grad|marking|assess|exam|quiz|proctor|invigilat|outcome/i.test(m[0])
          ? "purpose_education"
          : "purpose_hiring",
    categories: ["purpose"],
    patterns: PURPOSE_PATTERNS,
    value: (m) => m[0] ?? null,
  },
];

/**
 * A URL that is a purchase route rather than a vendor's domain.
 *
 * **Split out of a wildcard on 2026-07-30, because the wildcard was wrong about what it was
 * reading.** The clause that produced `hosted_checkout_link` matched `[a-z0-9-]+\.lemonsqueezy\.com`
 * and `[a-z0-9-]+\.gumroad\.com`, i.e. every subdomain a vendor has, so an API host and an
 * application host were both read as "the payment route itself" — the exact promise the kind's own
 * comment makes. On one automation tree, the closing-limb evidence was
 * an API base URL constant (a made-up line: `const API_BASE = 'https://api.lemonsqueezy.com/v1';`) in the LemonSqueezy
 * connector it publishes for its users, plus two `app.lemonsqueezy.com/subscription/1/...` URLs
 * inside a sample trigger payload.
 *
 * What is a purchase route: a host that exists only to take a payment (`buy.stripe.com`,
 * `checkout.stripe.com`, `pay.paddle.com`), or a vendor host on a purchase path
 * (`*.lemonsqueezy.com/checkout`, `*.lemonsqueezy.com/buy`, `gumroad.com/l/`). Everything else on
 * a vendor's domain is still emitted, as `commercial_documented` — the kind that says "a vendor
 * appears here" without claiming a payment happens here. Nothing is dropped.
 *
 * **The subdomain starts only where a run of its characters starts, or right after a previous
 * match, the form the hosted-checkout clause above was given.** Read from every
 * position of a long run of `[a-z0-9-]`, the subdomain read that run to its end each time, and
 * `insidePurchaseUrl` runs this pattern over the whole line once for every commercial hit on it:
 * one 5,000-character line of 200 `Stripe.` hits and a run took the census 2.0 s. A start inside a
 * run can only find a match the run's own start already found, since both end at the same `.`;
 * the one start the scan reaches without having tried the run's start is right after a previous
 * match, and every match that ends inside a run ends in `.com`, `/checkout` or `/buy`, which the
 * look-behind admits. Same matches, same spans.
 */
const PURCHASE_URL =
  /(?:https?:\/\/)?(?:(?:buy|checkout)\.stripe\.com|pay\.paddle\.com|(?:(?<![a-z0-9-])|(?<=\.com|\/checkout|\/buy))[a-z0-9-]+\.lemonsqueezy\.com\/(?:checkout|buy)|(?:www\.)?gumroad\.com\/l\/)/gi;

/** Is the character at `index` inside a purchase URL on this line? */
function insidePurchaseUrl(line: string, index: number): boolean {
  PURCHASE_URL.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = PURCHASE_URL.exec(line)) !== null) {
    if (index >= hit.index && index < hit.index + hit[0].length) return true;
    if (hit[0].length === 0) PURCHASE_URL.lastIndex++;
  }
  return false;
}

/**
 * Class names that name a sensitive-capability API and carry NO construct in their own pattern.
 *
 * Everything else the permission collector matches brings its construct with it — a `.requestAccess`,
 * a `.requestAuthorization`, a `(`, or a plist key. These seven are the word alone, and a word alone
 * matches a sentence.
 */
const BARE_PERMISSION_CLASSES = new Set([
  "CLLocationManager",
  "CNContactStore",
  "EKEventStore",
  "HKHealthStore",
  "SFSpeechRecognizer",
  "CMMotionActivityManager",
  "CBCentralManager",
]);

/**
 * Whether a bare class name at `index` is USED AS A SYMBOL on this line, or written in a sentence.
 *
 * **Structural, not a word list** — the same discriminator `commercialKind` uses for a vendor name,
 * and for the same reason: whether a name is code or prose is a question about the characters around
 * it, which is a fact, rather than about whether the sentence looks technical, which would be a
 * guess. A symbol is annotated, constructed, dereferenced, subscripted or passed:
 *
 *   `private let store: CNContactStore`      `var m: EKEventStore?`      `[CBCentralManager]`
 *   `let l = CLLocationManager()`            `HKHealthStore.isHealthDataAvailable()`
 *
 * A sentence puts a word before it and a word after it:
 *
 *   `The app historically used CLLocationManager but no longer does.`
 *   `"help.contacts": "We use CNContactStore to read your address book"`
 *
 * Neither outcome drops the hit. This chooses between two kinds.
 */
export function usedAsSymbol(line: string, index: number, end: number): boolean {
  // The trailing whitespace starts only where a whitespace run starts: `\s+$` read every
  // run in the text before the hit to its end from each position in it, once per hit, and one
  // 5,000-character line of a long run and 130 class names took the census 1.3 s. The first
  // trailing run starts after a non-space or at 0, so it is the same match.
  const before = line.slice(0, index).replace(/(?<!\s)\s+$/, "");
  const after = line.slice(end).replace(/^\s+/, "");
  // Annotated, assigned, subscripted, parenthesised, generic, or an argument.
  if (/[:=[(<&,?|]$/.test(before)) return true;
  if (/\b(?:new|as|try|await|return|is)$/.test(before)) return true;
  // Constructed, dereferenced, optional-chained, closed, separated or terminated.
  // "." is a dereference only when an identifier follows it; a sentence ending at the class name
  // ("… comes from CLLocationManager.") is prose even inside a non-documentary file (re-check
  // residual, 2026-09-03). The other separators keep their code reading.
  if (/^\.[A-Za-z_$]/.test(after)) return true;
  if (/^[(?!,)\];:>]/.test(after)) return true;
  // A bare name that ends the line with nothing before it but an assignment-free keyword is code
  // too (`private let store: CNContactStore` already matched above); an empty `after` with a word
  // immediately before it is a sentence's last word and is not.
  return false;
}

/**
 * Which kind a permission-apis match is: a plist DECLARATION, a runtime REQUEST, a name written in a
 * DOCUMENT, or a Web API.
 *
 * Split out of the collector table for the reason `commercialKind` is: the test is about the match's
 * CONTEXT — is this name used as a symbol or written in a sentence — and that needs the whole line
 * and the match position, not just the captured value.
 *
 * **No branch drops a match.** A name this function declines to call a request becomes
 * `ios_permission_documented_*`, which is still a fact, still counted, still shown, and still says
 * that the file names the capability. Same design as `commercialKind`: the collector says which of
 * several things a hit is, and never that a hit is nothing.
 */
function permissionKind(m: RegExpExecArray): string {
  const value = m[1] ?? "api";
  if (m[0].startsWith("NS")) return `ios_permission_declared_${value.toLowerCase()}`;
  const APPLE =
    /AVCaptureDevice|PHPhotoLibrary|CLLocationManager|CNContactStore|EKEventStore|CMMotionActivityManager|HKHealthStore|LAContext|ATTrackingManager|UNUserNotificationCenter|SFSpeechRecognizer|CBCentralManager|requestWhenInUse|requestAlways|requestTrackingAuthorization|evaluatePolicy/;
  if (!APPLE.test(m[0])) return `permission_${value.toLowerCase()}`;
  if (BARE_PERMISSION_CLASSES.has(value)) {
    const line = m.input ?? "";
    if (!usedAsSymbol(line, m.index, m.index + m[0].length)) {
      return `ios_permission_documented_${value.toLowerCase()}`;
    }
  }
  return `ios_permission_requested_${value.toLowerCase()}`;
}

/**
 * Which kind a commercial-signals match is.
 *
 * Kept out of the collector table because the test is about the match's *context* — is this a call,
 * a link, or a sentence — and that needs the whole line and the match position, not just the
 * captured value.
 *
 * **Every branch below routes a match to a kind, and no branch drops one.** A match this function
 * declines to call a payment route becomes `commercial_documented`, which the gate still reads on
 * `price-charged-for-the-product` and still shows the reader. That is the whole design: the
 * collector says which of several things a hit is, and never decides that a hit is nothing.
 */
function commercialKind(m: RegExpExecArray): string {
  const line = m.input ?? "";
  const value = m[1] ?? "";
  const matched = m[0] ?? "";

  const DONATION = /donate|opencollective|ko-fi|buymeacoffee|patreon|liberapay|paypal\.me|paypal\.com\/(?:donate|paypalme)|github\.com\/sponsors|tidelift|thanks\.dev/i;
  // **The call-site test reads the captured value, not the whole match**, because the widened
  // patterns of 2026-08-03 capture the call and nothing else, and `m[0]` carries the trailing
  // `(` and sometimes a leading `new `. The original four alternatives are kept verbatim so the
  // behaviour of every line that already produced a `subscription_route` is unchanged.
  //
  // The second half is the languages the JavaScript-only test could not see. Two of the widened
  // families are ordinary English words in their own right — Go's `subscription.New(` and the
  // Java/C# `…CreateParams` / `…Service` symbols — so those count only with a payment vendor named
  // on the same line. Everything else carries the vendor inside the match.
  const afterValue = line.slice(m.index + (matched.startsWith(value) ? 0 : matched.indexOf(value)) + value.length);
  const beforeValue = line.slice(0, m.index + (matched.startsWith(value) ? 0 : matched.indexOf(value)));
  const constructedOrInvoked = /^\s*(?:\(|\{|\.builder\b)/.test(afterValue) || /\bnew\s+$/.test(beforeValue);
  const isCallSite =
    /checkout\.sessions\.create|billing_?portal|paymentIntents|createPaymentIntent|subscriptions\.create/.test(matched) ||
    (BILLING_CALL_VALUE.test(value) &&
      (!BILLING_CALL_VALUE_NEEDS_VENDOR.test(value) ||
        (PAYMENT_VENDOR_ON_LINE.test(line) && constructedOrInvoked)));

  // 1. The captured value is itself a donation host. Decided on the value, not on the line, so that
  //    nothing else on the line can move it and it cannot swallow anything else.
  if (/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/sponsors|opencollective\.com|ko-fi\.com|buymeacoffee\.com|patreon\.com|liberapay\.com|paypal\.me|paypal\.com\/(?:donate|paypalme)|donate\.stripe\.com|tidelift\.com|thanks\.dev)/i.test(value)) {
    return "donation_link";
  }

  // 2. A purchase route. **This test now runs BEFORE the line-level donation test, which is the
  //    order it should always have had.** Until 2026-07-30 a donation word anywhere on the line
  //    relabelled a `buy.stripe.com` purchase URL as `donation_link` and thereby removed it from
  //    the limb that closes the gate — a fact whose kind and value contradicted each other, lost in
  //    the silent direction, with nothing in the report saying a reclassification had happened.
  //    Demonstrated on `export const TIERS = { donate: 'https://patreon.com/x', pro:
  //    'https://buy.stripe.com/zZyYxX987' }`, where the closing limb ended up holding nothing.
  if (insidePurchaseUrl(line, m.index)) {
    // The URL's own capture is a host and carries a dot; a bare vendor NAME (`stripe` inside
    // `buy.stripe.com`) is the same link seen a second time, so it stays documentary rather than
    // becoming a second, weaker copy of one piece of evidence.
    return value.includes(".") ? "hosted_checkout_link" : "commercial_documented";
  }
  if (isCallSite) return "subscription_route";
  if (/licen[cs]e|activation/i.test(matched)) return "licence_key_check";
  if (/^(?:amount|price|total|subtotal)$/.test(value) && /\d/.test(matched)) return "monetary_amount_literal";
  if (/unit_amount|STRIPE_PRICE|price[_A-Za-z]*[Ii]d|subscription[_A-Za-z]*[Ii]d|[Pp]rice/.test(value)) {
    /* **A CONFIRMING CLAUSE BESIDE THE LOOSE PATTERN, added 2026-09-03, and not a removal.**
     *
     * `price_identifier` promises "an identifier NAME, such as `priceId` or `STRIPE_PRICE_ID_PRO`"
     * — `rules/gates/cra-scope.yaml`'s own words. The `subscription…Id` alternative reaches a great
     * deal that is not that: on one iOS tree, **most of its `price_identifier` facts were
     * `subscription_id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}`** in GitHub Actions workflows — an
     * Azure cloud subscription, a CI secret name, nothing to do with the product's own pricing —
     * and the other 3 were `subscriptionAttentionCardVisibleByUserId`, a UI flag. Recorded as hole
     * #10 of that run.
     *
     * **Nothing is dropped and the limb is unchanged.** A hit this clause declines becomes
     * `commercial_documented`, which `price-charged-for-the-product` reads exactly as it reads
     * `price_identifier` — the gate wires both kinds, and only those two, to that one
     * annotation-only limb. So this changes the WORD a reader is shown, never which rows they see
     * and never any verdict. Same shape as the `release_documented` and `commercial_documented`
     * reclassifications above: the collector says which of several things a hit is, and never that a
     * hit is nothing.
     *
     * What corroborates: the value itself names a price or an amount (`priceId`, `stripePrice`,
     * `unit_amount`, `STRIPE_PRICE_ID_PRO`), or a payment vendor is named on the same line — the
     * same `PAYMENT_VENDOR_ON_LINE` test the call-site branch above uses. */
    const priceShaped = /unit_amount|price/i.test(value) || PAYMENT_VENDOR_ON_LINE.test(line);
    return priceShaped ? "price_identifier" : "commercial_documented";
  }

  // 3. A vendor host on a vendor's domain that is NOT a purchase route: `api.lemonsqueezy.com`,
  //    `app.lemonsqueezy.com/subscription/1/...`, `app.gumroad.com`. A vendor appears; no payment
  //    demonstrably happens here. Documentary, and still shown.
  if (/^(?:[a-z0-9-]+\.)?(?:lemonsqueezy|gumroad)\.com$/i.test(value)) {
    return "commercial_documented";
  }

  // 4. A donation route named by the line rather than by the value: `paypal.me/x` reaches this
  //    function through the vendor clause as `paypal` + `.` + `m`, and the captured value alone
  //    carries no sign of what it is. Scoped away from call sites and from purchase URLs above, so
  //    the word "sponsor" beside real billing code cannot relabel it.
  if (!isCallSite && DONATION.test(line)) return "donation_link";

  // 5. What is left is a vendor name, and the question is whether the line USES it or MENTIONS it.
  //
  // **Corrected 2026-07-30. A vendor name followed by a file extension was read as a payment
  // vendor called in code**, because the dot of `stripe.svg` satisfied the `\.\w` member-access
  // test. On twelve previously unscanned repositories, two each
  // reached the gate's strongest verdict off one line, an SVG icon import
  // (a made-up line of that shape: `import StripeLogo from "assets/icons/stripe.svg"`); another's first
  // evidence was a file name such as `'paddle.md'`; a third's was an icon file name such as `'stripe.png'`, sorting
  // above a genuine `stripe.subscriptions.retrieve(...)` in the same tree. The shape occurs
  // in 7 of the 27 pinned repositories. An asset filename is not a call, which makes this the
  // collector being wrong about what it is reading rather than a false-positive rate to tune.
  //
  // The test is structural, not a list of extensions to exclude: a member access counts only where
  // the member is itself USED — dereferenced, called, indexed, assigned, or standing as a complete
  // expression. `stripe.checkout.`, `Stripe.api_key =`, `stripe.subscriptions.retrieve(`,
  // `stripe.prices[`, `stripe.api_key;` all pass; `stripe.svg"`, `paddle.md'`, `stripe.png'` and
  // `image: "Stripe.svg"` all fail, because **a quote follows the member**, and a name inside a
  // string literal that ends right after its extension is a filename rather than a call. That is
  // the discriminator, and it is why the terminator set below deliberately excludes `"` and `'`.
  // The bare-call form requires no space before the parenthesis, which is what a call looks like in
  // all six languages this collector reads — so `new Stripe(` passes and the English sentence
  // `Stripe (the payment provider)` does not.
  const after = line.slice(m.index + value.length);
  const usedInCode = /^\.[A-Za-z_$][\w$]*\s*(?:[.([=;,]|$)/.test(after) || /^\(/.test(after);

  // A vendor inside a URL or a bare domain is a link, not a call: `www.paypal.com/us/business` in a
  // tutorial blog post and `stripe.com/docs` in an example README were both reaching the verdict.
  const before = line.slice(Math.max(0, m.index - 12), m.index);
  const inUrl = /:\/\/|www\.$|\]\($/.test(before) || /^[a-z0-9-]*\.(com|io|dev|org)\b/i.test(after);
  return inUrl || !usedInCode ? "commercial_documented" : "payment_provider";
}

/**
 * Extensions whose contents describe what somebody intends to do, rather than what runs.
 *
 * Measured 2026-07-29: the release patterns' only two hits across four real repositories were
 * `eas build --profile development --platform android` in `docs/mobile/SPEC.md` and in
 * `docs/mobile/TODO.md`. A line in a TODO file is not a release step, and reporting it as one
 * tells the gate the tree ships something when what the tree has is a plan to. The hit is still
 * emitted — a document saying the product is published is genuine evidence a reader should weigh
 * — under a kind that says which of the two it is. Telling its own matches apart is what the
 * `kind` field is for; dropping them would be narrowing, and is not permitted.
 */
const PROSE_EXTS = new Set([
  "md", "mdx", "markdown", "rst", "txt", "adoc", "org",
  // Added 2026-09-03, in the direction this discount is safe to move in. Every one of these is a
  // document format a project writes prose in, and a release command or a billing call written in
  // one is a sentence about the product rather than a step that runs — the same statement the seven
  // above make. Widening the DISCOUNT can only ever move a hit from the stronger kind to the weaker
  // one, which is the direction the measured harm never came from: the recorded failure is a
  // documentation snippet CLOSING the CRA gate (in two trees, 2026-08-03), never a document
  // being read as a document.
  "asciidoc", "textile", "wiki", "mediawiki", "creole", "pod", "tex", "ipynb", "rdoc", "text",
]);

/**
 * Whether a file is a DOCUMENT describing what somebody intends to do, rather than code that runs.
 *
 * **This is the one extension test in this file that survives 2026-09-03, and it survives on a
 * measurement rather than on an argument.** It is not a gate: nothing is dropped either way, and the
 * only thing it decides is which of two kinds a hit is emitted under — `release_automation` /
 * `release_documented`, `subscription_route` / `commercial_documented`. Those pairs exist because
 * `subscription_route` is the single kind allowed to close the CRA gate's commercial limb, and it
 * was measured closing it off a documentation snippet in two trees.
 *
 * **A content replacement was built, measured on all five trees this wave was run against, and
 * rejected.** The candidate was `discover.ts`'s own prose-character ratio — the measurement that
 * separates a real document from a translation catalogue — asked of every file in place of this
 * list. It moved **26 facts in the harmful direction**: 17 real Stripe call sites in one tree's server routes, utilities and models
 * (corrected on independent verification, 2026-09-03), plus one in this
 * repository's own `shipped-mini` fixture, all relabelled from `subscription_route` to
 * `commercial_documented`; and 8 real release commands in `.sh`, `.yml`, `.js` and `.ts` files across
 * two trees relabelled from `release_automation` to `release_documented`. The cause is
 * that
 * `isProseLine` scores a line of at least 40 characters carrying at least 8 space-separated tokens as
 * a sentence, and `const session = await stripe.checkout.sessions.create({ mode: 'subscription' });`
 * is such a line. **That measurement was built to tell a document from a RECORD SET, not a document
 * from CODE**, and using it for the second question reads most source files as prose.
 *
 * So the extension list stays, widened above with the document formats it could not see, and this
 * comment records what was tried rather than leaving the survival of an extension test unexplained.
 * A content test that genuinely separates prose from code would replace it; this project does not
 * have one, and inventing one here would be a classifier of the product from source vocabulary, which this project does not build.
 */
function isDocumentaryFile(ext: string): boolean {
  return PROSE_EXTS.has(ext);
}

/**
 * Who made it, and when it was first released.
 *
 * Added 2026-07-29. Two limbs of the CRA gate turn on these facts and neither could be answered:
 * **who the duty is addressed to** (Article 3(13) manufacturer, Article 3(14) steward, Recital 18
 * contributor) and **when the requirements attach** (Article 69(2): a product already on the market
 * before 11 December 2027 is reached only by a substantial modification made from that date). An
 * independent pass answered both by hand on six trees out of one or two lines each, and reported
 * that no collector emitted an author, a publisher, a copyright holder or a release date.
 *
 * The addressee limb is annotation-only since the same day, so nothing these
 * facts produce can remove a finding. They can only put a name and a date next to one.
 */
const PROVENANCE_PROBES: DistributionProbe[] = [
  {
    kind: "publisher_identity",
    applies: (base) => base === "package.json",
    // The value must have something in it. An empty `"author": ""` produced `party:` on three of
    // four real repositories, which is a fact that says nothing and costs a row.
    find: (lines) =>
      probeLine(lines, /"(?:author|publisher)"\s*:\s*"?([^",}\s][^",}]*)/, (m) => `party:${m[1].trim()}`),
  },
  {
    kind: "copyright_holder",
    applies: (base) => /^(LICEN[CS]E|COPYING|NOTICE)(\.(md|txt|rst))?$/i.test(base),
    // The first copyright line **that is not the licence's own boilerplate**.
    //
    // Every GPL, AGPL and LGPL file carries "Copyright (C) 2007 Free Software Foundation, Inc."
    // as part of the licence text, and the Apache and MIT templates carry placeholder holders.
    // Reporting those as the project's copyright holder is not a false positive to be tuned away
    // later — it is the probe being wrong about what it is reading, and this exact error was
    // found and corrected in the CRA gate's prose on 2026-07-28, where "a foundation in the
    // copyright holders" was listed as a signal that the party might be an open-source steward.
    // Reintroducing it one day later in a collector is the same mistake in a new place.
    find: (lines) => {
      for (let i = 0; i < lines.length; i++) {
        const m = /Copyright\s*(?:\(c\)|©)?\s*([12]\d{3}(?:\s*-\s*[12]\d{3})?)\s*,?\s*(.+)/i.exec(lines[i]);
        if (!m) continue;
        const holder = m[2].trim();
        if (/Free Software Foundation|\[?yyyy\]?|\[name of copyright owner\]|<name of author>|\[fullname\]/i.test(holder)) continue;
        return [{ line: i + 1, value: `copyright:${m[1].replace(/\s+/g, "")}:${holder.slice(0, 60)}` }];
      }
      return [];
    },
  },
  {
    // The earliest dated heading in a changelog. A release history is the only thing in an ordinary
    // tree that says when a product was first placed on the market, and Article 69(2) turns on it.
    kind: "release_history",
    applies: (base) => /^CHANGELOG(\.(md|txt|rst))?$/i.test(base),
    find: (lines) => {
      const dates = [];
      for (let i = 0; i < lines.length; i++) {
        const m = /([12]\d{3}-[01]\d-[0-3]\d)/.exec(lines[i]);
        if (m) dates.push({ line: i + 1, value: m[1] });
      }
      if (dates.length === 0) return [];
      const earliest = dates.reduce((a, b) => (a.value <= b.value ? a : b));
      return [{ line: earliest.line, value: `earliest_dated_entry:${earliest.value}` }];
    },
  },
  {
    // A statement of how the project is governed. This is what Article 3(14)'s "systematically
    // providing support on a sustained basis" and "ensures the viability of those products" would
    // leave in a tree, and it is the kind the CRA gate's steward limb consults.
    kind: "governance_document",
    applies: (base) => /^(GOVERNANCE|MAINTAINERS)(\.(md|txt))?$/i.test(base),
    find: () => [{ line: 1, value: "governance_document" }],
  },
  {
    // **CODEOWNERS was in the list above until 2026-07-29 and is not any more.** Measured across
    // the 27 pinned repositories: 13 carry a CODEOWNERS and **none** carries a GOVERNANCE or a
    // MAINTAINERS file, so the kind was in practice a CODEOWNERS detector — and it was wired to
    // the limb that asks whether the party is an open-source software steward under Article 3(14).
    // A GitHub review-routing line (`* @org/team`) evidences none of that Article's four
    // cumulative elements: a legal person, other than a manufacturer, systematically supporting
    // free and open-source software intended for commercial activities, and ensuring its
    // viability. It is the probe being wrong about what it is reading, which the project's rules permit
    // correcting at any time.
    //
    // The fact is still emitted, under a name that says what it is, and no limb consults it.
    kind: "code_review_routing",
    applies: (base) => /^CODEOWNERS(\.(md|txt))?$/i.test(base),
    find: () => [{ line: 1, value: "code_review_routing" }],
  },
];

/**
 * The manifest-shaped half of the distribution collector.
 *
 * These are facts about *what a file is*, not about a line inside it: a `package.json` without
 * `"private": true` is publishable, an `AndroidManifest.xml` is a mobile bundle. A line collector
 * cannot express that, because the deciding condition is the absence of a line elsewhere in the
 * same file — the same limitation recorded on 2026-07-27 for absence-based rules.
 *
 * Every probe still anchors its fact to a real line, because a census fact carries `file`, `line`
 * and `line_text` and the reconcile gate's ledger checks that the line exists and says what the
 * fact claims.
 */
interface DistributionProbe {
  kind: string;
  applies: (base: string, path: string) => boolean;
  find: (lines: string[]) => { line: number; value: string }[];
}

/**
 * The one distribution kind that is evidence *against* the limb, and the only one that is capped.
 *
 * In one large monorepo this kind came to hundreds of rows — one for each private example,
 * template and test package — against a few dozen publishable ones. All of them say the same
 * thing, and none of them bears on the question. A nested workspace package
 * marked private does not stop its sibling from being published, so it is a fact about the
 * repository's layout, not about what the product supplies. Emitting hundreds of rows of it would spend
 * the reader's attention on the one kind that cannot change an answer.
 *
 * So the shallowest few are emitted and the true total goes to `stats.manifests_marked_not_published`.
 * The cap is counted, never silent: a suppression nobody can count is a suppression nobody can
 * check, which is the same rule `identifiers_not_requests` and `declared_only_dependencies` follow.
 * Shallowest first because depth is the only ordering that means anything here — the manifest at
 * or nearest the root is the one whose privacy is about the product rather than about a workspace.
 */
const MARKED_NOT_PUBLISHED = "marked_not_published";
const MARKED_NOT_PUBLISHED_CAP = 5;

/**
 * The key that says a file is a bill of materials in one of the two commonly used machine-readable
 * formats. One object, read by both `sbom_artifact` probes below — the one keyed on names that say
 * "software" and the one keyed on `bom.json`/`bom.xml`, where it is the deciding condition rather
 * than only the anchor.
 */
const SBOM_FORMAT_KEY = /("bomFormat"|"specVersion"|"spdxVersion"|"SPDXID"|SPDXVersion:|<bom\b)/;

/** First line matching `re`, with the capture that names the thing. */
function probeLine(lines: string[], re: RegExp, label: (m: RegExpExecArray) => string) {
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    const m = re.exec(lines[i]);
    if (m) return [{ line: i + 1, value: label(m) }];
  }
  return [];
}

const DISTRIBUTION_PROBES: DistributionProbe[] = [
  {
    // npm's own marker for a manifest that is not published. Emitted as evidence *against* the
    // limb, and named so that it cannot be mistaken for evidence for it. A gate that sees no
    // distribution facts at all cannot tell "nothing was looked for" from "we looked and the
    // tree says it is not published"; this is the same reason the walker reports its exclusions
    // and the discovery step reports its fetch failures.
    kind: MARKED_NOT_PUBLISHED,
    applies: (base) => base === "package.json",
    find: (lines) => probeLine(lines, /"private"\s*:\s*true/, () => "npm:private"),
  },
  {
    // **Not `published_package`, and the difference is the whole point.** Measured 2026-07-29 on
    // four real repositories: this probe reported `@example/shared`, `@example/functions`
    // and `budget-cap` as published packages. None of the three is published anywhere — they are
    // ordinary workspace packages in a monorepo, which carry a name and a version because npm
    // requires them to and carry no `"private": true` because nobody bothered. What the tree
    // actually states is narrower: this manifest is not marked unpublishable. The gate reads the
    // kind, so a kind that overstates its evidence is a defect in the census, not in the gate.
    kind: "publishable_package",
    applies: (base) => base === "package.json",
    find: (lines) =>
      lines.some((l) => /"private"\s*:\s*true/.test(l))
        ? []
        : probeLine(lines, /"name"\s*:\s*"([^"]+)"/, (m) => `npm:${m[1]}`),
  },
  {
    kind: "publishable_package",
    applies: (base) => base === "Cargo.toml" || base === "composer.json" || base === "go.mod",
    find: (lines) =>
      probeLine(lines, /^\s*(?:module\s+(\S+)|name\s*=\s*"([^"]+)"|"name"\s*:\s*"([^"]+)")/, (m) =>
        `pkg:${m[1] ?? m[2] ?? m[3]}`,
      ),
  },
  {
    kind: "publishable_package",
    applies: (base) => base === "pyproject.toml" || base === "setup.py" || base.endsWith(".gemspec"),
    find: (lines) => probeLine(lines, /^\s*name\s*[=:]\s*["']([^"']+)["']/, (m) => `pkg:${m[1]}`),
  },
  {
    // A command the user runs. Article 3(1) counts a software product whatever its shape, and a
    // CLI is the shape this product's own audience ships most often.
    kind: "command_line_entry_point",
    applies: (base) => base === "package.json" || base === "pyproject.toml" || base === "Cargo.toml",
    find: (lines) =>
      probeLine(lines, /^\s*(?:"bin"\s*:|\[project\.scripts\]|\[\[bin\]\]|console_scripts)/, () => "cli"),
  },
  {
    // Files that exist for no purpose other than producing a store bundle. The name is the
    // evidence, so these carry no marker requirement — the same treatment `tauri.conf.json` gets
    // below, and for the same reason. `eas.json` is here because its only content is build and
    // submit profiles for Expo Application Services; it is not a file an application acquires by
    // accident.
    kind: "mobile_app_bundle",
    applies: (base) =>
      base === "AndroidManifest.xml" ||
      base === "Info.plist" ||
      base === "project.pbxproj" ||
      base === "eas.json",
    find: (lines) => {
      const named = probeLine(
        lines,
        /(<manifest|CFBundleIdentifier|objectVersion|"submit"|"build")/,
        (m) => `bundle:${m[1].replace(/[^A-Za-z]/g, "")}`,
      );
      return named.length > 0 ? named : [{ line: 1, value: "bundle:manifest_file" }];
    },
  },
  {
    kind: "mobile_app_bundle",
    applies: (base) =>
      base === "pubspec.yaml" ||
      base === "app.json" ||
      /^app\.config\.(js|ts|mjs|cjs)$/.test(base) ||
      /^build\.gradle(\.kts)?$/.test(base),
    // `app.json`, `build.gradle` and `eas.json` also exist in trees that ship nothing to a store,
    // so each asks for the marker that means a bundle: an Expo config, an application id, a
    // bundle identifier.
    //
    // **The quoted-key-only version of this regex missed a real store-targeted app.** Measured
    // 2026-07-29: one application carries an Expo build configuration at `apps/mobile/app.config.ts`,
    // which is TypeScript — `bundleIdentifier: 'com.example.mobile'`, unquoted key, importing
    // `ExpoConfig` from `expo/config` — and the probe asked for `"expo":` with quotes. It found
    // nothing, and a repository holding a fully configured mobile application produced no
    // distribution evidence of any kind. That is the expensive direction: an extra fact is
    // dismissed in one line by the reader, an absent one is never seen by anyone.
    //
    // **Corrected 2026-07-29 after an independent pass read the tree.** This comment previously
    // said that repository "ships an Expo application to both stores". It does not: the store
    // listings are unchecked TODO items, `eas.json` carries build profiles and no `submit`
    // profile, and the only `eas` command in the tree sits in two documents. A build
    // configuration is what this probe finds, and saying more than that about somebody else's
    // repository is the same class of error as a rule asserting a duty that does not exist.
    find: (lines) => {
      const marker =
        /(["']?expo["']?\s*:|ExpoConfig|expo\/config|bundleIdentifier|applicationId|<manifest|CFBundleIdentifier|flutter\s*:|objectVersion|"submit"\s*:|package\s*=)/;
      return probeLine(lines, marker, (m) => `bundle:${m[1].replace(/[^A-Za-z]/g, "") || "manifest"}`);
    },
  },
  {
    // Chrome and Firefox extensions. `manifest_version` is the discriminator: a web app manifest
    // is also called manifest.json and does not carry it.
    kind: "browser_extension",
    applies: (base) => base === "manifest.json",
    find: (lines) => probeLine(lines, /"manifest_version"\s*:\s*(\d+)/, (m) => `extension:mv${m[1]}`),
  },
  {
    kind: "installable_web_client",
    applies: (base) => base === "manifest.json" || base === "manifest.webmanifest" || base === "site.webmanifest",
    find: (lines) =>
      lines.some((l) => /"manifest_version"/.test(l))
        ? []
        : probeLine(lines, /"(start_url|display)"\s*:/, (m) => `webmanifest:${m[1]}`),
  },
  {
    // A container build. Weaker evidence than a registry push and emitted separately from it, so a
    // reader can see which one the tree carries. See the note on the distribution collector above
    // for why this stopped being excluded.
    kind: "container_build_config",
    applies: (base) => /^(Dockerfile|Containerfile)(\..+)?$/i.test(base) || /^docker-compose(\..+)?\.ya?ml$/i.test(base),
    find: (lines) => {
      const named = probeLine(lines, /^\s*(FROM|image:)\s*(\S+)/i, (m) => `container:${m[2].slice(0, 50)}`);
      return named.length > 0 ? named : [{ line: 1, value: "container:build_file" }];
    },
  },
  {
    kind: "desktop_installer",
    applies: (base) =>
      base === "tauri.conf.json" ||
      base === "appcast.xml" ||
      /^electron-builder\.(yml|yaml|json|js|cjs)$/.test(base),
    // Anchored to the key that names the installer rather than to line 1, so the `line_text` a
    // reader is shown says what the fact claims. A config that carries none of these keys still
    // counts — the file's own name is the evidence — and then the anchor is its first line.
    find: (lines) => {
      const named = probeLine(
        lines,
        /("identifier"|"productName"|"appId"|appId\s*:|<title>)/,
        (m) => `desktop:${m[1].replace(/[^A-Za-z]/g, "")}`,
      );
      return named.length > 0 ? named : [{ line: 1, value: "desktop:config_file" }];
    },
  },
  {
    // A committed software bill of materials. The generation-step half of this signal is the
    // `sbom-generation` line collector above; this is the artefact itself, sitting in the tree.
    //
    // The name is the evidence, which is why this probe applies by basename and matches whatever
    // the file's first structural line happens to be. `sbom.json`, `*.cdx.json` and `*.spdx.json`
    // are files a repository does not acquire by accident, the same reasoning `eas.json` and
    // `tauri.conf.json` carry above. They are already walked and read: the walker is a denylist and
    // `.json`/`.xml`/`.spdx` are in neither its binary set nor its ignore set, so no new glob was
    // needed to reach them — only this probe to notice them.
    //
    // **`bom.json` and `bom.xml` are NOT here**, and the probe below is where they went: those two
    // names say "bill of materials" without saying "software", and a bill of materials in an
    // electronics project is a parts list. CRA's own audience is products with digital elements,
    // which is exactly where hardware BOMs live.
    //
    // **Read in one direction only.** A hit is evidence that a record exists and a reader can open
    // the line. No hit says nothing: Recital 77 states manufacturers "should not be obliged to make
    // the SBOM public", so a compliant manufacturer may hold the record anywhere but here. Wiring
    // this kind to a limb of the CRA scope gate is forbidden and `KIND_POWER` in
    // a test pins that; it evidences Annex I Part II point (1), not Article 2(1).
    //
    // **A record under `test/`, `fixtures/` or `__mocks__/` is not the product's record**, and this
    // probe skipped nothing until 2026-08-05. `reconcile.ts:112` and `scan.ts:34` both pass
    // `includeNonProduction: true`, so the census genuinely reads those trees in a real scan; an
    // independent check measured `test/fixtures/sbom.json` emitting `sbom_artifact` exactly as a
    // released record does. A bill of materials committed as a test input is an input to a test of
    // SBOM-handling code — the "is this the thing at all?" question, answered no, which is the one
    // correction the project's rules permit at any time and not a false-positive trim.
    //
    // The usual objection — that a null result must never narrow the scanner — does not reach this
    // one, because the paragraph above already says a missing `sbom_artifact` is not evidence of
    // anything. Nothing is being read as absence; a fact that would be shown to an adjudicator as
    // corroboration that the manufacturer holds the record is being stopped from claiming a test
    // fixture is that record. `isNonProductionPath` is `walk.ts`'s own exported hook, added for
    // exactly this — a consumer deciding whether "is this a test?" matters for its own question.
    kind: "sbom_artifact",
    applies: (base, path) => {
      if (isNonProductionPath(path)) return false;
      const b = base.toLowerCase();
      return (
        b === "sbom.json" ||
        b === "sbom.xml" ||
        b === "sbom.spdx" ||
        b === "sbom.spdx.json" ||
        /\.(cdx|spdx)\.(json|xml)$/.test(b) ||
        /\.spdx$/.test(b)
      );
    },
    find: (lines) => {
      // The line that names the format the record is written in, so `line_text` says what the fact
      // claims. A record carrying none of these keys still counts — the file's own name is the
      // evidence — and then the anchor is its first line.
      const named = probeLine(lines, SBOM_FORMAT_KEY, (m) => `sbom:${m[1].replace(/[^A-Za-z]/g, "")}`);
      return named.length > 0 ? named : [{ line: 1, value: "sbom:artifact_file" }];
    },
  },
  {
    // `bom.json` and `bom.xml`, which say "bill of materials" and not "software bill of materials".
    //
    // Same kind, same evidence, one extra condition: the file must carry a format key. An
    // independent check measured 2026-08-05 that a hardware `bom.json` — an electronics parts list,
    // which is what that name means in the half of this Regulation's audience that ships hardware —
    // emitted `sbom_artifact` with `line_text` `{`, saying nothing that supports what the fact
    // claims. Requiring the key is not a narrowing of what a real record looks like: CycloneDX JSON
    // mandates `bomFormat` and `specVersion`, CycloneDX XML has a `<bom>` root, SPDX JSON mandates
    // `spdxVersion` and SPDX tag-value has `SPDXVersion:`, so every bill of materials in a commonly
    // used and machine-readable format — which is the only kind Annex I Part II point (1) asks
    // about — still fires under either name.
    kind: "sbom_artifact",
    applies: (base, path) => {
      if (isNonProductionPath(path)) return false;
      const b = base.toLowerCase();
      return b === "bom.json" || b === "bom.xml";
    },
    find: (lines) => probeLine(lines, SBOM_FORMAT_KEY, (m) => `sbom:${m[1].replace(/[^A-Za-z]/g, "")}`),
  },
  {
    // The manifest half of the generation step, and it exists because of a reachability defect
    // rather than because a manifest is a different kind of evidence.
    //
    // **No `package.json` reaches any line collector.** The dependency branch of `runCensus`
    // `continue`s before the `for (const collector of COLLECTORS)` loop, so
    // `"scripts": { "sbom": "cyclonedx-npm --output-file sbom.json" }` — the commonest npm
    // generation step there is — produced no fact at all. Measured 2026-08-05 by an independent
    // check with the same bytes in two files: `control.txt` produced three facts and `package.json`
    // produced none. That is the under-reading direction, which the project's rules name as the expensive
    // one: nothing is produced and the tool says nothing was found.
    //
    // A probe rather than a re-route, and rather than moving the manifest branch after the loop:
    // only the bill-of-materials patterns run over a manifest, so nothing else about what the
    // general line collectors do to arbitrary `package.json` content changes. It runs before the
    // dependency branch because the whole probe loop does (see `runCensus`).
    //
    // Both shapes are the same fact and both are worth the same amount. A devDependency on
    // `@cyclonedx/cyclonedx-npm` and a `sbom` script that invokes it are each a line a reader opens
    // and confirms, and neither is a claim that a record exists — the kind's own asymmetry note on
    // the collector above governs both.
    kind: "sbom_generation_step",
    applies: (base) => base === "package.json",
    find: (lines) => {
      const hits: { line: number; value: string }[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < lines.length; i++) {
        for (const re of SBOM_GENERATION_PATTERNS) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(lines[i])) !== null) {
            const value = m[1];
            if (!value) continue;
            // Same dedupe key the line collector uses, for the same reason: one line naming a tool
            // twice is one fact, and a fact_id collision silently drops one of a pair.
            const key = `${i}|${value}`;
            if (seen.has(key)) continue;
            seen.add(key);
            hits.push({ line: i + 1, value });
          }
        }
      }
      return hits;
    },
  },
];

/** Package name from an import specifier: `@scope/pkg/sub` → `@scope/pkg`, `pkg/sub` → `pkg`. */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) return null;
  if (specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

const IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
];

/* ============================================================================================= *
 * The Swift/Apple manifests, added 2026-09-03.
 * ============================================================================================= *
 *
 * **What this closes.** Until today the dependency collector read one manifest format,
 * `package.json`, and said so in terms: "THE ONLY MANIFEST THIS BRANCH READS IS `package.json`, AND
 * THAT IS A LIMIT, NOT A RESULT." The third real pillar-2 run measured that limit on a pure
 * Swift/SwiftPM tree, which declares no npm manifest anywhere, so `dependency_inventory`,
 * `declared_only_dependencies` and the `dependencies` collector all returned exactly zero, and that
 * zero says nothing whatever about what the product ships. The run's single most consequential
 * finding — an undisclosed Firebase Crashlytics integration carrying a per-account user ID — was
 * found by a person reading `Package.resolved` and the XcodeGen manifests BY HAND, outside every
 * collector.
 *
 * **The hazard this is written against, in the branch's own words:** "widening the manifest side
 * alone would be worse than the gap: every Python and Go package would be declared with no import
 * pattern able to find a call site, and every one of them would be marked `declared_only` — turning
 * the one field in this file that exists to prevent a false accusation into a machine for making
 * them." So the manifest side is never widened alone. Three things land together:
 *
 *   1. the manifests below, which say what is declared;
 *   2. `MODULE_IMPORT_PATTERNS`, which reads the call site a Swift or Objective-C file writes;
 *   3. the alias table each manifest builds as it is read, which is what joins a MODULE name
 *      (`FirebaseCrashlytics`) to a PACKAGE identity (`firebase-ios-sdk`) — a join no naming rule can
 *      make on its own, and which every one of these formats states explicitly.
 *
 * **DIRECT and RESOLVED are held apart, and that distinction is the second half of the same
 * safeguard.** `Package.swift`'s `dependencies:`, a `Podfile`'s `pod` lines and an XcodeGen
 * `packages:` block are what a developer wrote; `Package.resolved` and `Podfile.lock` are a
 * resolver's output over the whole TRANSITIVE graph, where "declared and imported from nowhere" is
 * the ordinary state of most members (of one iOS tree's pins, `abseil-cpp-binary`, `nanopb`,
 * `leveldb` and `grpc-binary` are transitive C libraries the application never names). Resolved
 * declarations therefore reach `dependency_inventory` — where a reader can see that this tree
 * resolves `firebase-ios-sdk` at `12.14.0`, which is the fact the run needed — and reach neither
 * `declared_only_dependencies` nor `facts`, exactly as `devDependencies` does not.
 *
 * **Every shape below was copied from a real tree in this repository's corpus**, named per reader.
 * Nothing here was written from memory of a format.
 */

/**
 * SwiftPM's own package identity: the last path component of the repository URL, without a trailing
 * `.git`, lower-cased. **This is not a convention this file invents** — it is the rule SwiftPM
 * applies, and it is why `Package.resolved`'s `identity` field reads `firebase-ios-sdk` for
 * `https://github.com/firebase/firebase-ios-sdk`. Using it is what lets a `Package.swift` URL, an
 * XcodeGen `url:` and a `Package.resolved` pin land on ONE inventory entry instead of three.
 */
function spmIdentityOfUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const last = trimmed.split("/").pop() ?? trimmed;
  return last.replace(/\.git$/i, "").toLowerCase();
}

/** Case- and separator-insensitive form, for joining a module name to a package identity. */
function normaliseModuleName(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

/**
 * A module import, as Swift and Objective-C write one.
 *
 * Made-up lines in the shapes real files write: `import ExampleCrashReporter`,
 * `import ExampleSdk`. The Objective-C forms are `@import ExampleCore;` and
 * `#import <ExampleCore/ExampleCore.h>`, which is how a pod is reached from a `.m`/`.h` file.
 *
 * `@testable import X` is deliberately reached: it is a real import of a real module, and refusing
 * it would mark a package used only by the test target as imported from nowhere. Whether a test
 * file's call site counts is a question for the reader, and `call_sites[]` names the file.
 */
const MODULE_IMPORT_PATTERNS = [
  /^\s*(?:@testable\s+)?import\s+(?:struct\s+|class\s+|enum\s+|protocol\s+|func\s+|typealias\s+|var\s+|let\s+)?([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^\s*@import\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^\s*#import\s*<([A-Za-z_][A-Za-z0-9_]*)\//gm,
];

/** One package a non-npm manifest declares, with the modules that manifest says it supplies. */
interface ManifestPackageRead {
  /** The identity the inventory files it under. */
  name: string;
  /** The constraint the manifest writes, verbatim where there is one. */
  version: string;
  /** 1-based line the declaration is written on. */
  line: number;
  /** Module names this manifest states the package supplies, if it states any. */
  products: string[];
}

/**
 * `Package.swift` — a SwiftPM manifest, read for its `dependencies:` list and its product mapping.
 *
 * Made-up lines in the shapes real `Package.swift` files write:
 *
 *   .package(url: "https://example.com/acme/NetKit.git", from: "5.4.0"),
 *   .package(url: "https://example.com/acme/TextKit.git", branch: "2.2.5-beta"),
 *   .package(url: "https://example.com/acme/Exporter.git", revision: "1fd5ad…"),
 *   .package(url: "https://example.com/acme/Store.swift.git", exact: "7.8.0"),
 *   .product(name: "OrderedThings", package: "acme-collections"),
 *
 * The manifest is Swift source, so this is a line read and not an evaluation — a dependency list
 * built by a loop or an `if` is out of reach, and that is a limit stated rather than hidden.
 */
function readPackageSwift(lines: string[]): ManifestPackageRead[] {
  const byName = new Map<string, ManifestPackageRead>();
  const PACKAGE = /\.package\s*\(([^)]*)\)/g;
  for (let i = 0; i < lines.length; i++) {
    PACKAGE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PACKAGE.exec(lines[i])) !== null) {
      const args = m[1];
      const url = /\burl\s*:\s*"([^"]+)"/.exec(args);
      const path = /\bpath\s*:\s*"([^"]+)"/.exec(args);
      const id = /\bid\s*:\s*"([^"]+)"/.exec(args);
      const declaredName = /\bname\s*:\s*"([^"]+)"/.exec(args);
      const name = url
        ? spmIdentityOfUrl(url[1])
        : id
          ? id[1].toLowerCase()
          : path
            ? spmIdentityOfUrl(path[1])
            : declaredName
              ? declaredName[1].toLowerCase()
              : null;
      if (!name) continue;
      // Every constraint form SwiftPM writes, in the order a manifest writes them. A `.package` with
      // no constraint at all (a local `path:`) keeps an empty version rather than an invented one.
      const version =
        /\b(?:from|exact|revision|branch|upToNextMajor|upToNextMinor)\s*:\s*"([^"]+)"/.exec(args)?.[1] ??
        /"([^"]+)"\s*\.\.[.<]\s*"([^"]+)"/.exec(args)?.slice(1, 3).join("..<") ??
        "";
      if (!byName.has(name)) byName.set(name, { name, version, line: i + 1, products: [] });
    }
  }
  // `.product(name: "OrderedCollections", package: "swift-collections")` is the manifest's own
  // statement of which module a package supplies — the join a naming rule cannot make.
  const PRODUCT = /\.product\s*\(\s*name\s*:\s*"([^"]+)"\s*,\s*package\s*:\s*"([^"]+)"/g;
  for (const line of lines) {
    PRODUCT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PRODUCT.exec(line)) !== null) {
      const entry = byName.get(m[2].toLowerCase()) ?? byName.get(spmIdentityOfUrl(m[2]));
      if (entry && !entry.products.includes(m[1])) entry.products.push(m[1]);
    }
  }
  return [...byName.values()];
}

/**
 * `Package.resolved` — SwiftPM's lockfile, in both formats real trees carry.
 *
 * Version 2/3 (made up):
 *   { "pins": [ { "identity": "example-sdk", "kind": "remoteSourceControl",
 *                 "location": "https://example.com/acme/example-sdk",
 *                 "state": { "revision": "8d5b…", "version": "12.14.0" } } ], "version": 2 }
 *
 * Version 1 (made up):
 *   { "object": { "pins": [ { "package": "netkit",
 *                             "repositoryURL": "https://example.com/acme/NetKit.git",
 *                             "state": { "revision": "7595…", "version": "5.12.0" } } ] },
 *     "version": 1 }
 *
 * A pin names no products, so the modules it supplies are unknown from this file alone — which is
 * one more reason its declarations are RESOLVED and never DIRECT.
 */
function readPackageResolved(content: string, lines: string[]): ManifestPackageRead[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
  const root = parsed as Record<string, unknown>;
  const object = root.object as Record<string, unknown> | undefined;
  const pins = (Array.isArray(root.pins) ? root.pins : Array.isArray(object?.pins) ? object.pins : null) as
    | Record<string, unknown>[]
    | null;
  // A `Package.resolved` whose `pins` is not an array is recorded, never silently read as empty —
  // the same discipline the `package.json` branch applies per block.
  if (!pins) return { error: "no `pins` array in either the v1 (`object.pins`) or v2/v3 (`pins`) position" };
  const out: ManifestPackageRead[] = [];
  for (const pin of pins) {
    if (typeof pin !== "object" || pin === null) continue;
    const location = typeof pin.location === "string" ? pin.location : typeof pin.repositoryURL === "string" ? pin.repositoryURL : "";
    const identity =
      typeof pin.identity === "string"
        ? pin.identity.toLowerCase()
        : typeof pin.package === "string"
          ? pin.package.toLowerCase()
          : location
            ? spmIdentityOfUrl(location)
            : "";
    if (!identity) continue;
    const state = (pin.state ?? {}) as Record<string, unknown>;
    const version =
      typeof state.version === "string"
        ? state.version
        : typeof state.branch === "string"
          ? state.branch
          : typeof state.revision === "string"
            ? state.revision
            : "";
    out.push({ name: identity, version, line: lineNaming(lines, identity), products: [] });
  }
  return out;
}

/**
 * `Podfile` — the CocoaPods manifest, read for its `pod` lines.
 *
 * Made-up lines in the shapes real Podfiles write:
 *
 *   pod 'ExampleLogger', '3.7.4'
 *   pod 'ExampleSDK/Crashlytics', '~> 8.0'
 *   pod 'RNExampleSignin', :path => '../node_modules/@example/signin'
 *   pod "share_example_models", :path => ".symlinks/plugins/share_example/ios/Models"
 *
 * **The subspec is part of the name and also names the module.** CocoaPods builds
 * `pod 'Firebase/Crashlytics'` as the module `FirebaseCrashlytics`; that is the tool's own rule for
 * a subspec, and it is why this reader states the joined form as a product rather than guessing at
 * one. The plain form's module is the pod name itself.
 */
function readPodfile(lines: string[]): ManifestPackageRead[] {
  const out: ManifestPackageRead[] = [];
  const seen = new Set<string>();
  const POD = /^\s*pod\s+['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?/;
  for (let i = 0; i < lines.length; i++) {
    const m = POD.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    // A second quoted argument is a version requirement only where it reads like one; `:path =>`
    // and `:git =>` forms carry a path or a URL there instead and are left with no version.
    const second = m[2] ?? "";
    const version = /^[~><=^]*\s*\d/.test(second) ? second : "";
    const products = name.includes("/") ? [name.split("/").join("")] : [name];
    out.push({ name, version, line: i + 1, products });
  }
  return out;
}

/**
 * `Podfile.lock` — CocoaPods' resolved graph.
 *
 * A made-up lock in the shape real ones write:
 *
 *   PODS:
 *     - example-native (1.5.16):
 *       - React-Core
 *     - ExampleAuth/Core (1.7.6)
 *
 * **The shipped walker never offers this file**, because `walk.ts`'s `IGNORE_FILES` excludes every
 * lockfile of every ecosystem by name, `podfile.lock` among them — a repository-wide decision about
 * generated payloads that is not this wave's to change. The reader exists anyway, is exercised by
 * this repository's fixtures, and runs for any caller that hands the census a file list of its own.
 * Stated here rather than left for a reader to discover from a silent zero.
 */
function readPodfileLock(lines: string[]): ManifestPackageRead[] {
  const out: ManifestPackageRead[] = [];
  const seen = new Set<string>();
  let inPods = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^PODS:\s*$/.test(line)) {
      inPods = true;
      continue;
    }
    // Any other column-0 key ends the PODS section: DEPENDENCIES, SPEC REPOS, SPEC CHECKSUMS…
    if (inPods && /^\S/.test(line)) break;
    if (!inPods) continue;
    // Two-space indent is a pod; four or more is one pod's dependency on another, already listed
    // in its own right at two spaces.
    const m = /^ {2}- ([^ (]+)(?: \(([^)]*)\))?/.exec(line);
    if (!m) continue;
    // **CocoaPods QUOTES a name that contains a `+`**, and the quotes are its syntax and not part of
    // the name: a lock line such as `  - "ExampleUtils/NSData+zlib (7.13.3)":` (made up)
    // and the reader published the package as `"ExampleUtils/NSData+zlib`, leading quote and all
    // (independent verification, 2026-09-03, LOW 6). Unreachable through the shipped walker, which
    // never offers a lockfile — and this reader ships for direct callers, which is exactly why it has
    // to be right. The quoted form wraps the name AND the version together, so the version is
    // recovered from the same strip rather than from a second pattern.
    const quoted = /^ {2}- "([^"]+?)(?: \(([^)]*)\))?"/.exec(line);
    const name = quoted ? quoted[1] : m[1];
    const version = quoted ? (quoted[2] ?? "") : (m[2] ?? "");
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      version,
      line: i + 1,
      products: name.includes("/") ? [name.split("/").join("")] : [name],
    });
  }
  return out;
}

/**
 * An XcodeGen `project*.yml` — the DIRECT declaration population of an Xcode project that has no
 * `Package.swift`.
 *
 * A made-up example in the shape real XcodeGen project files write:
 *
 *   packages:
 *     ExampleSDK:
 *       url: https://example.com/acme/example-sdk
 *       exactVersion: 12.14.0
 *   …
 *       - package: ExampleSDK
 *         product: ExampleCrashlytics
 *
 * **This is the file that carries the product mapping on such a tree, and without it the join
 * cannot be made.** `example-sdk` and `ExampleCrashlytics` share no normalised form; the
 * `packages:` alias gives alias -> URL -> identity, and the `- package:` / `product:` pair gives
 * alias -> module. Both are written by the developer, in their own file, and neither is inferred.
 *
 * Name-as-identity CONFIRMED BY PARSING, on the same discipline as `isXcprivacyPath`: the file must
 * be named `project*.yml`/`.yaml` and must carry a `packages:` block with at least one entry that
 * names a `url:` or a `path:`. A YAML file that merely has the word `packages` in it reads as
 * nothing.
 */
function isXcodeGenProjectPath(base: string): boolean {
  return /^project[^/]*\.(ya?ml)$/i.test(base);
}

interface XcodeGenRead {
  packages: ManifestPackageRead[];
  /** Alias -> SwiftPM identity, from this file's own `packages:` block. */
  aliases: [string, string][];
  /**
   * `- package: <alias>` / `product: <module>` pairs from this file, **unresolved**.
   *
   * They are returned raw and joined tree-wide rather than here, because XcodeGen splits a project
   * across files: a tree can declare an alias `ExampleSDK` in one project file and write
   * `- package: ExampleSDK` / `product: ExampleCrashlytics` in another, which `include:`s
   * the first. Resolved per file, that pair joined to nothing and `example-sdk` was published
   * as "declared and imported from nowhere" — a false statement about the developer's code, and
   * exactly the failure the manifest readers were built not to make. Measured on the real tree
   * before this was split out.
   */
  productPairs: [string, string][];
}

function readXcodeGenPackages(lines: string[]): XcodeGenRead {
  const aliases: [string, string][] = [];
  const aliasToIdentity = new Map<string, string>();
  const byIdentity = new Map<string, ManifestPackageRead>();
  let inPackages = false;
  let alias: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      alias = null;
      continue;
    }
    if (inPackages) {
      if (/^\S/.test(line)) {
        inPackages = false;
        alias = null;
      } else {
        const head = /^ {2}([A-Za-z_][\w.+-]*)\s*:\s*$/.exec(line);
        if (head) {
          alias = head[1];
          continue;
        }
        if (alias) {
          const url = /^\s{3,}(?:url|path)\s*:\s*(\S+)\s*$/.exec(line);
          if (url) {
            const identity = spmIdentityOfUrl(url[1].replace(/^["']|["']$/g, ""));
            aliasToIdentity.set(alias, identity);
            aliases.push([alias, identity]);
            if (!byIdentity.has(identity)) {
              // The ALIAS is a product name in its own right, and this is XcodeGen's own rule
              // rather than a guess: where a target names a package with no `product:`, the product
              // taken is the one bearing the package's name. `SnapshotTesting` and `BitwardenSdk`
              // are aliases whose modules are imported under exactly those names, and without this
              // both would have been published as declared-and-never-imported.
              byIdentity.set(identity, { name: identity, version: "", line: i, products: [alias] });
            } else if (!byIdentity.get(identity)!.products.includes(alias)) {
              byIdentity.get(identity)!.products.push(alias);
            }
            continue;
          }
          const ver = /^\s{3,}(?:exactVersion|minVersion|maxVersion|minorVersion|majorVersion|from|branch|revision)\s*:\s*(\S+)\s*$/.exec(line);
          if (ver) {
            const identity = aliasToIdentity.get(alias);
            const entry = identity ? byIdentity.get(identity) : undefined;
            if (entry && entry.version === "") entry.version = ver[1].replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "");
          }
        }
      }
    }
  }
  const productPairs: [string, string][] = [];
  for (let i = 0; i < lines.length; i++) {
    const pkg = /^\s*-\s*package\s*:\s*(\S+)\s*$/.exec(lines[i]);
    if (!pkg) continue;
    const prod = /^\s*product\s*:\s*(\S+)\s*$/.exec(lines[i + 1] ?? "");
    if (!prod) continue;
    productPairs.push([pkg[1], prod[1]]);
  }
  return { packages: [...byIdentity.values()], aliases, productPairs };
}

/**
 * The 1-based line a name is written on, or 1 where it is not found.
 *
 * The same floor `dependencyKeyLines` uses and for the same reason: a citation this function cannot
 * place points at line 1, which is a floor and never a claim about a different line.
 */
function lineNaming(lines: string[], name: string): number {
  const needle = `"${name}"`;
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle) || lines[i].includes(name)) return i + 1;
  return 1;
}

/**
 * The blocks of a `package.json` this census takes a declaration from, in the order it reads them.
 *
 * **Four, since 2026-08-28**. Until that day it was the two runtime blocks
 * below, and a package declared only in `devDependencies` or `peerDependencies` was absent from the
 * inventory entirely — an analytics SDK in `devDependencies` and a payment SDK in
 * `peerDependencies` are ordinary manifest shapes, and neither reached any reader. Every entry now
 * carries the block it came from in `DependencyDeclaration.field`, so the widening adds
 * information and takes none away: a reader who wants only the runtime packages filters on it.
 *
 * **`bundledDependencies` is excluded, and it is excluded for a reason, not by omission.** It is an
 * ARRAY OF NAMES, not a name-to-version map. Reading it through the same parse would recreate
 * defect D7 by construction — `Object.entries` on a non-map spreads whatever it is handed, which is
 * how `"dependencies": "stripe"` once produced six packages named `0`…`5` at versions
 * `s`,`t`,`r`,`i`,`p`,`e`, each carrying `declared_only`, the one marker in this file whose job is
 * to prevent a false accusation. npm also requires every name it bundles to be declared in one of
 * the four blocks above, so nothing it names is lost by not reading it.
 *
 * Written once and read by both the parse and the line locator: the locator has to look for a key
 * in exactly the blocks the parse takes names from, or a name declared in `dependencies` would be
 * cited at the line where `devDependencies` happens to mention it first. That is now stronger than
 * "the same set" — both are keyed by BLOCK AND NAME, so one package declared twice gets one
 * citation per block.
 */
const MANIFEST_DEPENDENCY_BLOCKS = [
  "dependencies",
  "optionalDependencies",
  "devDependencies",
  "peerDependencies",
] as const satisfies readonly DependencyManifestBlock[];

/**
 * The subset of the four whose keys are dependencies of the product AT RUNTIME.
 *
 * **What still turns on it**, all three unchanged by the 2026-08-28 widening: `facts`' dependency
 * rows, `declared_only_dependencies`, and `stats.packages_declared`. A `facts` dependency row is
 * categorised `recipients`, so promoting a build-time package into it would be a change to what the
 * scanner detects rather than to what the inventory carries, and the ruling was about the
 * inventory. The one thing that widened is the inventory itself, where `field` says which block
 * each declaration came from.
 *
 * The identity a consumer is told it can check — `packages_declared` minus
 * `packages_with_call_sites` equals `declared_only_dependencies.length` — holds because all three
 * are drawn from this subset and none of them from the other two blocks.
 */
const RUNTIME_DEPENDENCY_BLOCKS = [
  "dependencies",
  "optionalDependencies",
  // The three DIRECT-declaration blocks the Swift/Apple manifests carry, added 2026-09-03. Each is
  // what a developer wrote down, in the same sense `dependencies` is: a `Package.swift` dependency
  // list, a `Podfile`'s `pod` lines, an XcodeGen `packages:` block. The two RESOLVED blocks —
  // `spm-resolved` (`Package.resolved`) and `pods-resolved` (`Podfile.lock`) — are deliberately NOT
  // here, for the reason `devDependencies` is not: they are a resolver's output over the whole
  // transitive graph, so "declared and imported from nowhere" is the ordinary state of most of their
  // members and saying it about each one would be a false statement about the developer's code
  // rather than a record of one. They reach `dependency_inventory` and stop there.
  "spm-dependencies",
  "pods",
  "xcodegen-packages",
] as const;
const RUNTIME_DEPENDENCY_BLOCK_SET: ReadonlySet<string> = new Set(RUNTIME_DEPENDENCY_BLOCKS);

/**
 * The key `dependencyKeyLines` files a citation under: the BLOCK and the NAME, never the name alone.
 *
 * A manifest that declares `commander` at `^12.0.0` in `dependencies` and at `^0.0.1` in
 * `devDependencies` produces two declarations, and each has to cite its own line. Keyed by name
 * alone, both would cite whichever came first and one of the two published versions would sit
 * beside a line that names the other.
 */
const blockKey = (field: string, name: string): string => `${field}\u0000${name}`;

/**
 * Where each runtime dependency's key is written in a manifest, by line.
 *
 * **The parse cannot answer this and that is why it exists.** `JSON.parse` returns values with no
 * positions, so a census built from it can say a package is declared and never say where — and
 * "where" is the whole of what makes a declaration checkable by a reader in one second, which is the
 * standard every other fact in this file is held to (`file`, `line`, `line_text` on `CensusFact`).
 *
 * Scanned rather than parsed a second time, and deliberately conservative:
 *
 * - It tracks WHICH BLOCK it is inside and files every citation under the BLOCK AND THE NAME, so
 *   `"stripe"` under `devDependencies` is not the line cited for `"stripe"` under `dependencies` —
 *   and since 2026-08-28, when both are read, each is cited at its own line and carries its own
 *   declared version. A block ends at the first line whose closing brace sits at or left of the
 *   block key's own indentation, which is what a formatter produces — or on its own opening line,
 *   where the whole block is written inline, in which case every key it holds is read off that line.
 * - A key it cannot find keeps line 1. A minified manifest is one line, so line 1 is the true
 *   answer there; for any other shape it is a floor, never a claim about a different line.
 * - It never decides WHETHER a package is declared. That stays with `JSON.parse`, which is the only
 *   reading of the file that cannot be fooled by a string containing a brace.
 */
function dependencyKeyLines(lines: string[], cut: ReadonlySet<number> = new Set()): Map<string, number> {
  const found = new Map<string, number>();
  let insideAtIndent: number | null = null;
  let insideBlock: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (insideAtIndent !== null && insideBlock !== null) {
      const close = /^(\s*)[}\]]/.exec(line);
      if (close && close[1].length <= insideAtIndent) {
        insideAtIndent = null;
        insideBlock = null;
      } else {
        const key = /^\s*"((?:[^"\\]|\\.)*)"\s*:/.exec(line);
        // A line cut at the ceiling (`manifestLocatorLines`) that shows neither a close nor a key in its first part may
        // hold either past it, so the block is left here: its later keys keep the line-1 floor, where reading on would
        // file another block's keys under this one (D4 below).
        if (!key && cut.has(i)) {
          insideAtIndent = null;
          insideBlock = null;
          continue;
        }
        if (key) {
          let name: string;
          try {
            name = JSON.parse(`"${key[1]}"`) as string;
          } catch {
            continue;
          }
          const k = blockKey(insideBlock, name);
          if (!found.has(k)) found.set(k, i + 1);
        }
        continue;
      }
    }
    const block = /^(\s*)"([A-Za-z]+)"\s*:\s*\{(.*)$/.exec(line);
    if (block && (MANIFEST_DEPENDENCY_BLOCKS as readonly string[]).includes(block[2])) {
      // **A block written entirely on one line closes on that line.** The close test above looks
      // for a leading `}` on a LATER line, so an inline block never closed: every subsequent key in
      // the file, `devDependencies`' children included, was then recorded as if it sat inside the
      // runtime block, and `"commander"` declared at `^12.0.0` in `dependencies` was cited at the
      // `devDependencies` line naming it at `^0.0.1` — the exact failure this function's docstring
      // says it prevents. Found by independent verification, 2026-08-28, and measured there at
      // ZERO occurrences over the 3,507 `package.json` files of the 98-tree corpus: 20 write an
      // inline runtime block and all 20 write it empty.
      //
      // Every key an inline block holds is ON the opening line, so that line is the true citation
      // for each of them. A `}` inside a version string cuts the scan short and leaves the keys
      // after it on the line-1 floor, which is the direction the docstring allows — a floor, never
      // a claim about a different line.
      // A cut line whose first part holds no `}` may close the block past the cut, so it is read as an
      // inline block up to the cut and never opened: a block opened on it could file the next block's keys as its own.
      const closeAt = block[3].indexOf("}") >= 0 ? block[3].indexOf("}") : cut.has(i) ? block[3].length : -1;
      if (closeAt < 0) {
        insideAtIndent = block[1].length;
        insideBlock = block[2];
      } else {
        for (const m of block[3].slice(0, closeAt).matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)) {
          let name: string;
          try {
            name = JSON.parse(`"${m[1]}"`) as string;
          } catch {
            continue;
          }
          const k = blockKey(block[2], name);
          if (!found.has(k)) found.set(k, i + 1);
        }
      }
    }
  }
  return found;
}

/**
 * The lines a manifest's key LOCATOR reads: the ceiling's lines, with every line the ceiling emptied given
 * back as its first `MINIFIED_LINE_LIMIT` characters, and the set of those cut lines (0-based).
 *
 * **Whether a package is declared is `JSON.parse`'s answer, on the whole text** (the docstring above): the parse is
 * linear, so it needs no ceiling, and for a time it read the ceiling's text, so a declaration on a line
 * past the ceiling was not declared at all - a package missing from the inventory, a vendor the cross-check never
 * named, and a manifest whose emptied last entry left a trailing comma "parse-failed". The locator's patterns still
 * never see more than the ceiling: a key at the start of a cut line is found where it is written; one past the cut
 * keeps the line-1 floor. The cut line stays named in `files_long_lines_not_read`, since nothing else reads it.
 * The raw text is split on a string, never a pattern.
 */
function manifestLocatorLines(
  raw: string,
  lines: string[],
  blanked: readonly { line: number }[],
): { lines: string[]; cut: Set<number> } {
  const cut = new Set<number>();
  if (blanked.length === 0) return { lines, cut };
  const rawLines = raw.split("\n");
  const out = lines.slice();
  for (const { line } of blanked) {
    let text = rawLines[line - 1] ?? "";
    if (text.endsWith("\r")) text = text.slice(0, -1);
    out[line - 1] = text.slice(0, MINIFIED_LINE_LIMIT);
    cut.add(line - 1);
  }
  return { lines: out, cut };
}

/** One manifest's statement about one package: the version it names, where, and in which block. */
interface PackageDeclaration {
  file: string;
  line: number;
  version: string;
  field: DependencyManifestBlock;
  ecosystem: DependencyEcosystem;
}

/**
 * The non-npm manifests, by the basename that identifies each, with the block and family each
 * declaration is filed under.
 *
 * **Name-as-identity, confirmed by parsing.** Every reader below returns nothing from a file whose
 * contents are not what the name promises, and a `Package.resolved` that parses and carries no pins
 * is recorded in `manifests_not_usable` rather than read as an empty tree. This is the same
 * discipline `store-declarations.ts` applies to `PrivacyInfo.xcprivacy`.
 */
const SWIFT_MANIFESTS: {
  matches: (base: string) => boolean;
  field: DependencyManifestBlock;
  ecosystem: DependencyEcosystem;
  /** `whole`: the file's whole text and its locator lines, for a reader whose parse needs no ceiling. */
  read: (
    content: string,
    lines: string[],
    whole: { text: string; locatorLines: () => string[] },
  ) => ManifestPackageRead[] | { error: string };
}[] = [
  {
    matches: (b) => b === "Package.swift",
    field: "spm-dependencies",
    ecosystem: "swiftpm",
    read: (_c, lines) => readPackageSwift(lines),
  },
  {
    matches: (b) => b === "Package.resolved",
    field: "spm-resolved",
    ecosystem: "swiftpm",
    read: (_content, _lines, whole) => readPackageResolved(whole.text, whole.locatorLines()),
  },
  {
    matches: (b) => b === "Podfile",
    field: "pods",
    ecosystem: "cocoapods",
    read: (_c, lines) => readPodfile(lines),
  },
  {
    matches: (b) => b === "Podfile.lock",
    field: "pods-resolved",
    ecosystem: "cocoapods",
    read: (_c, lines) => readPodfileLock(lines),
  },
  {
    matches: isXcodeGenProjectPath,
    field: "xcodegen-packages",
    ecosystem: "swiftpm",
    read: (_c, lines) => readXcodeGenPackages(lines).packages,
  },
];

export interface CensusOptions {
  files: string[];
  readFile: (relPath: string) => string | null;
  /** Call sites recorded per package before the list is truncated; the count is always exact. */
  callSiteLimit?: number;
  /**
   * Call-site examples carried on one `dependency_inventory` entry. See
   * `INVENTORY_CALL_SITE_EXAMPLES` for the measurement that set the default, and note that the
   * entry's `call_site_count` is exact whatever this is — the cap truncates the examples and never
   * the count, so a reader is never shown a smaller number than the census found.
   */
  inventoryCallSiteExamples?: number;
  /**
   * Applied to a fact's trimmed line BEFORE it is cut to `LINE_TEXT_CHARS`. `reconcile` passes
   * the credential redaction: cut first, a credential straddling the cut no longer matched its clause, and its first
   * characters stayed in clear in reconcile-input.json. The scan's own census pass prints no line and passes none.
   */
  lineText?: (trimmedLine: string) => string;
  /**
   * THE PER-FILE WALL-CLOCK BUDGET, in milliseconds, or `Infinity` (the default) for none - the scan's
   * `--file-budget`, handed in by `runCensusPass`. Until 2026-10-20 this pass read every
   * file with no clock at all: the engine's budget stopped a hostile file, and the census then spent
   * 7 s on the same file with one pattern. Each file now has its own clock, started before its read
   * and read before each unit of work (each probe, the manifest parse, the comment blanking, the line
   * split, and every block of lines of up to `CENSUS_CLOCK_CHARS` characters, or one longer line, for
   * the import patterns and for each collector). A spent budget stops the file there: what it raised
   * stays, and the file is named in `files_stopped_for_time`, never skipped silently. It is per FILE and
   * per PASS, as the engine's is per file and per thread: the census is a second pass over the file, so
   * one file can cost its budget in each.
   */
  fileBudgetMs?: number;
}

/**
 * How many characters of lines the census reads between two readings of the file's clock. One
 * reading per line cost a `performance.now()` per line per collector; one per 16 KB costs about one per
 * collector per small file, and bounds what a stop can overshoot by to one block of lines, or one longer
 * line, through one collector's patterns. No line is longer than `MINIFIED_LINE_LIMIT` (the census reads
 * every file through the engine's line ceiling), so one block is at most this many characters plus one such line.
 */
export const CENSUS_CLOCK_CHARS = 16_384;

/** A fact's `line_text`: at most this many characters of the trimmed line, taken after `CensusOptions.lineText`. */
export const LINE_TEXT_CHARS = 300;

/**
 * Call-site examples one inventory entry carries. **Chosen by measuring the document, not by taste.**
 *
 * Measured 2026-08-28 over eight real trees. Five of them declare an npm
 * manifest; the other three
 * declare none at all — see `runCensus`'s dependency branch for why that is a limit and not a
 * result. **244 entries, 207 of them with at least one call site.** The inventory's own bytes,
 * summed over the eight documents, against the examples cap:
 *
 *   N = 0    41,149 B     N = 3    66,036 B      N = 6    76,133 B
 *   N = 1    54,229 B     N = 4    69,859 B      N = 8    81,568 B
 *   N = 2    61,311 B     N = 5    73,209 B      N = 10   86,335 B      N = ∞   147,291 B
 *
 * **N = 3, and the reason is the shape of both curves.** What each further example BUYS falls off a
 * cliff and then flattens: a first call site exists for 100 % of the 207 called packages, a second
 * for 51 %, a third for 34 % — and then 28 %, 25 %, 22 %, 21 %. The third example is the last one
 * that roughly halves; from the fourth on, each costs about the same 3.5–4.8 KB and reaches a
 * steadily smaller slice of the same packages. What it COSTS is 24,887 B over N = 0, 0.09 % of the
 * eight documents' 26.3 MB. Uncapped is 106,142 B over N = 0 — **4.3× the N = 3 examples** — to
 * carry a tail nobody reads: one package on one tree holds about 150 call sites and one on
 * another nearly as many, and an agent handed that many file:line pairs for one package samples them,
 * which is the failure `adjudication_group` exists to prevent one level out.
 *
 * **The examples are file and line only — no `line_text`.** Measured the same way: carrying the text
 * as `CensusCallSite` does costs 90,250 B at N = 3 against 66,036 B, a 1.37× multiplier, for a line
 * the adjudicating agent can open — and it runs in the user's agent and the user pays for every byte. `CensusFact.call_sites` still carries text and this cap does not touch it.
 */
const INVENTORY_CALL_SITE_EXAMPLES = 3;

export function runCensus(opts: CensusOptions): CensusResult {
  const facts: CensusFact[] = [];
  const byCollector: Record<string, number> = {};
  const callSiteLimit = opts.callSiteLimit ?? 5;
  // The whole line through `opts.lineText` (the redaction, in reconcile), then the cut: never the other way round.
  const lineTextOf = (raw: string): string => {
    const trimmed = raw.trim();
    return (opts.lineText ? opts.lineText(trimmed) : trimmed).slice(0, LINE_TEXT_CHARS);
  };

  const inventoryExamples = opts.inventoryCallSiteExamples ?? INVENTORY_CALL_SITE_EXAMPLES;

  /**
   * Every declaration of every declared package, keyed by package name.
   *
   * **One map, four blocks, and the narrower populations are FILTERED out of it rather than
   * collected beside it** — the project's rule "never keep a second copy of anything two places must
   * agree on". `declared_only_dependencies`, the `facts` dependency rows and
   * `stats.packages_declared` take the declarations whose `field` is a runtime block; the inventory
   * takes all of them.
   */
  const declaredPackages = new Map<string, PackageDeclaration[]>();
  const importSites = new Map<string, CensusCallSite[]>();
  /**
   * Swift/Objective-C module imports, keyed by the MODULE name as written.
   *
   * Held apart from `importSites` until every manifest has been read, because the join from a module
   * to a package identity is stated BY the manifests (`.product(name:package:)`, an XcodeGen
   * `- package:`/`product:` pair, a CocoaPods subspec) and a file may import a module hundreds of
   * lines before the manifest that names it is walked.
   */
  const moduleImportSites = new Map<string, CensusCallSite[]>();
  /**
   * Normalised module name -> the package identities the tree's own manifests say supply it.
   *
   * A Set, not a single identity: two manifests in a monorepo may both supply a module name, and
   * dropping one of them would attribute a call site to whichever was walked first.
   */
  const moduleAliases = new Map<string, Set<string>>();
  /**
   * XcodeGen's package alias -> SwiftPM identity, and its `- package:`/`product:` pairs, both
   * accumulated over the WHOLE tree and joined after the walk.
   *
   * XcodeGen splits one project across several manifests that `include:` each other, so the block
   * declaring an alias and the target line naming that alias's product are routinely in different
   * files, in either walk order.
   */
  const xcodeGenAliases = new Map<string, string>();
  const xcodeGenProductPairs: [string, string][] = [];
  const noteAlias = (module: string, packageName: string) => {
    const key = normaliseModuleName(module);
    if (key === "") return;
    const set = moduleAliases.get(key) ?? new Set<string>();
    set.add(packageName);
    moduleAliases.set(key, set);
  };
  const notPublished: { file: string; line: number; value: string; text: string }[] = [];
  /**
   * Manifests this census opened and could NOT take a declaration from, named with the reason.
   *
   * Emitted only when it has a member, and that asymmetry is deliberate: on every tree read so far
   * it is empty, and an always-present empty array on `CensusResult` would rewrite two golden
   * census documents to say nothing. What it prevents is a forbidden state one level down —
   * `dependency_inventory: []` from a tree whose only `package.json` carries a UTF-8 BOM read
   * identically to `dependency_inventory: []` from a tree with no npm manifest at all, while the
   * inventory's own description told the reader that an empty inventory is a statement about npm
   * manifests. `stats.manifests_not_usable` in `findings.json` carries the count, so the
   * distinction is visible in the document layer 2 reads and on the console a person reads.
   */
  const manifestsNotUsable: ManifestNotUsable[] = [];

  let filesRead = 0;
  let identifiersNotRequests = 0;
  /**
   * Files the census opened and refused because their bytes are not text.
   *
   * **The only capability test left in front of the collectors, and it is about the ENCODING.** A
   * file with a NUL in its first 4096 characters cannot be matched line by line; what the collectors
   * would produce from it is mojibake with a line number attached. The rule is the walker's own,
   * imported rather than restated (`decodedTextIsBinary`), so the two can never disagree —
   * `discover.ts`'s `screenIfNotText` reaches for the same helper for the same reason.
   *
   * **It removes nothing from any real scan.** In the shipped pipeline `opts.files` is
   * `walkTarget().files`, which has already applied the identical test to the identical window, so
   * this can only ever fire for a direct caller handing in a list nobody sniffed. It is counted
   * rather than silent for the reason everything else in this file is: a refusal nobody can count is
   * a refusal nobody can check.
   */
  let filesNotText = 0;
  const matchedFiles = new Set<string>();

  const budgetMs = opts.fileBudgetMs ?? Infinity;
  // Read ONCE: with the budget off, not one `performance.now()` is called below.
  const budgetOn = Number.isFinite(budgetMs);
  const stoppedForTime: CensusStoppedFile[] = [];
  const stoppedFiles = new Set<string>();
  /** Files read without their lines over the line ceiling, each line named. */
  const longLinesNotRead: CensusLongLinesFile[] = [];
  /*
   * WHERE A CALL SITE COULD BE AND WAS NOT READ. `declared_only` is an absence: "no line of this tree imports
   * the package". Since the line ceiling a line past it is emptied before the import pass, and a file the
   * budget stops before its import pass ends is not read to its end, so an import on such a line is not seen and the
   * package came out `declared_only` exactly like one nothing imports - "no problems found" over lines nobody read. The
   * import pass reads EVERY readable file (it is ungated, see below), so any such line anywhere could hold the call site.
   * These count them: the lines past the ceiling in files the import pass read, and the files it did not read to their
   * end (stopped for time before the pass ended, or not readable at all). Where any is non-zero, every entry that claims
   * no call site carries `call_sites_not_read` with the counts, and what the person reads says "not read", not "absent".
   * Nothing is dropped and no entry moves: the entry stays where it was, marked as what it is.
   */
  let callSiteLinesNotRead = 0;
  const callSiteFilesNotRead = new Set<string>();
  /** Whether the import pass of the file being read has ended; a stop before that leaves its call sites unread. */
  let importsRead = false;
  /** What the census spent on each file, carried to the request-construct pass, which charges the same budget. */
  const censusElapsed = new Map<string, number>();
  files: for (const file of opts.files) {
    // The clock starts before the read, as the engine's does.
    let fileStartedAt = budgetOn ? performance.now() : 0;
    /** Reads the clock; when the budget is spent, names the file and the stage it stopped in, and says so. */
    const over = (stage: string, lines?: { read: number; total: number }): boolean => {
      if (!budgetOn) return false;
      const elapsed = performance.now() - fileStartedAt;
      if (elapsed < budgetMs) return false;
      stoppedFiles.add(file);
      if (!importsRead) callSiteFilesNotRead.add(file);
      stoppedForTime.push({
        file,
        stage,
        budget_ms: Math.round(budgetMs),
        elapsed_ms: Math.round(elapsed),
        ...(lines ? { lines_read: lines.read, lines_total: lines.total } : {}),
      });
      return true;
    };
    importsRead = false;
    const read = opts.readFile(file);
    if (read === null) {
      // Not read at all: a call site in it is not seen either.
      callSiteFilesNotRead.add(file);
      continue;
    }
    if (over("binary-check")) continue files;
    if (decodedTextIsBinary(read)) {
      filesNotText++;
      continue;
    }
    filesRead++;
    // THE LINE CEILING, THE ENGINE'S OWN. Everything below reads `content`, never `read`: every line
    // longer than MINIFIED_LINE_LIMIT is emptied in place, as the engine empties it, so no pattern here is handed a
    // line longer than that and one unit of work (a block of lines, one line, or one whole-file test) is bounded by
    // construction. A held pattern costs the square of its line; a file of lone carriage returns or of U+2028 is ONE
    // line ended by a line feed, so before this a one-megabyte line was one unit of work past any budget. What is
    // emptied is named in `files_long_lines_not_read`, never dropped silently.
    if (over("long-line-ceiling")) continue files;
    const ceiling = blankLongLines(read);
    if (ceiling.blanked.length > 0) longLinesNotRead.push({ file, threshold: MINIFIED_LINE_LIMIT, lines: ceiling.blanked });
    const content = ceiling.text;
    // The whole text, for the manifests' `JSON.parse` alone.
    const rawText = read;

    const base = file.replace(/\\/g, "/").split("/").pop() ?? "";
    if (over("line-split")) continue files;
    const probeLines = content.split(/\r?\n/);

    // Manifest-shaped distribution facts. Runs before the `package.json` branch below, because
    // that branch is the dependency pass and returns early — and `package.json` is the single
    // richest source of distribution evidence there is.
    for (const probe of [...DISTRIBUTION_PROBES, ...PROVENANCE_PROBES]) {
      if (!probe.applies(base, file)) continue;
      if (over(`probe:${probe.kind}`)) continue files;
      const isProvenance = PROVENANCE_PROBES.includes(probe);
      for (const hit of probe.find(probeLines)) {
        if (probe.kind === MARKED_NOT_PUBLISHED) {
          notPublished.push({ file, line: hit.line, value: hit.value, text: probeLines[hit.line - 1] ?? "" });
          continue;
        }
        facts.push({
          fact_id: factId(isProvenance ? "provenance" : "distribution", probe.kind, file, hit.line, hit.value),
          collector: isProvenance ? "provenance" : "distribution",
          kind: probe.kind,
          categories: [isProvenance ? "provenance" : "distribution"],
          value: hit.value,
          file,
          line: hit.line,
          line_text: lineTextOf(probeLines[hit.line - 1] ?? ""),
          depends_on_runtime_config: [],
        });
        const name = isProvenance ? "provenance" : "distribution";
        byCollector[name] = (byCollector[name] ?? 0) + 1;
        matchedFiles.add(file);
      }
    }

    /* The Swift/Apple manifests. **No `continue` afterwards, unlike the `package.json` branch
     * below**, and that is deliberate: a `Podfile` writes `source 'https://cdn.cocoapods.org/'` and
     * an XcodeGen manifest writes real URLs, so these files stay in the collector loop like every
     * other readable file. Removing them from it would be a subtraction taken as a side effect of
     * an addition, which is the one direction this file does not go. */
    for (const manifest of SWIFT_MANIFESTS) {
      if (over("swift-manifests")) continue files;
      if (!manifest.matches(base)) continue;
      // One statement on one line, so the clock read above it is inside (N)'s window; the locator runs inside this unit.
      const read = manifest.read(content, probeLines, { text: rawText, locatorLines: () => manifestLocatorLines(rawText, probeLines, ceiling.blanked).lines });
      if (!Array.isArray(read)) {
        manifestsNotUsable.push({
          file,
          reason: read.error.includes("`pins`") ? "no-dependency-block" : "parse-failed",
          detail: read.error,
        });
        continue;
      }
      if (manifest.field === "xcodegen-packages") {
        // The alias table and the `- package:`/`product:` pairs are accumulated tree-wide and
        // joined after the walk — see `xcodeGenAliases` for the real tree that made that necessary.
        const xg = readXcodeGenPackages(probeLines);
        for (const [alias, identity] of xg.aliases) xcodeGenAliases.set(alias, identity);
        xcodeGenProductPairs.push(...xg.productPairs);
      }
      for (const pkg of read) {
        const list = declaredPackages.get(pkg.name) ?? [];
        list.push({
          file,
          line: pkg.line,
          version: pkg.version,
          field: manifest.field,
          ecosystem: manifest.ecosystem,
        });
        declaredPackages.set(pkg.name, list);
        // Every package answers to its own identity, so `import ViewInspector` reaches the pin
        // `viewinspector` with no manifest having to say so; the products a manifest DOES state are
        // added beside that, never instead of it.
        noteAlias(pkg.name, pkg.name);
        for (const product of pkg.products) noteAlias(product, pkg.name);
      }
    }

    // **THE ONLY MANIFEST THIS BRANCH READS IS `package.json`, AND THAT IS A LIMIT, NOT A RESULT.**
    // A `pyproject.toml`, a `go.mod`, a `composer.json`, a `Cargo.toml`, a `mix.exs` or a `.csproj`
    // declares dependencies that nothing here parses, and `IMPORT_PATTERNS` below reads JavaScript
    // and TypeScript import syntax only, so a Python `import requests` is not a call site either.
    // Measured 2026-08-28 over eight real trees: a Composer tree, a Bundler tree
    // and a NuGet tree with dozens of project files declare **zero** packages here while
    // carrying dozens of manifests between them.
    //
    // It is written here, and repeated in `dependency_inventory`'s schema description and in the
    // skill sentence that hands the inventory to the adjudicating agent, because the expensive
    // direction of this particular gap is a reader concluding from an empty inventory that a tree
    // declares nothing. **Widening it is rule work with its own approval**, and widening the
    // manifest side alone would be worse than the gap: every Python and Go package would be
    // declared with no import pattern able to find a call site, and every one of them would be
    // marked `declared_only` — turning the one field in this file that exists to prevent a false
    // accusation into a machine for making them.
    if (base === "package.json") {
      if (over("package-manifest")) continue files;
      try {
        const pkg = JSON.parse(rawText) as Record<string, unknown>;
        const located = manifestLocatorLines(rawText, probeLines, ceiling.blanked);
        const keyLines = dependencyKeyLines(located.lines, located.cut);

        // **The value of a runtime dependency block is an object or it is nothing.**
        // `Object.entries` spreads whatever it is handed, so a manifest writing
        // `"dependencies": "stripe"` produced six inventory entries named `0`…`5` at versions
        // `s`, `t`, `r`, `i`, `p`, `e`, each marked `declared_only` — six packages that do not
        // exist, each carrying the one marker in this file whose job is to prevent a false
        // accusation. Such a manifest is invalid npm, so this is robustness rather than
        // correctness; the refusal is RECORDED rather than silent for the same reason the parse
        // failure below is. Found by independent verification, 2026-08-28.
        //
        // **THE GUARD IS PER BLOCK, AND THAT IS THE WHOLE POINT OF THE LOOP.** One malformed
        // `devDependencies` costs its own block and nothing else: the packages the same manifest
        // declares in `dependencies` are read, published and counted exactly as they would have
        // been, and the refusal is recorded with the block's name. A guard that gave up on the
        // manifest would let one bad block delete a healthy one's packages — the direction that
        // produces silence rather than noise.
        //
        // The four block names come from `MANIFEST_DEPENDENCY_BLOCKS` above and are the whole
        // population this inventory has. `bundledDependencies` is not among them because it is an
        // array of names rather than a name-to-version map, and reading it here would recreate D7
        // by construction; its members are declared in one of the four anyway.
        const declaredHere: {
          name: string;
          version: string;
          field: DependencyManifestBlock;
          ecosystem: DependencyEcosystem;
        }[] = [];
        for (const blockName of MANIFEST_DEPENDENCY_BLOCKS) {
          const value = pkg[blockName];
          if (value === undefined || value === null) continue;
          if (typeof value !== "object" || Array.isArray(value)) {
            manifestsNotUsable.push({
              file,
              reason: "block-not-an-object",
              detail: `"${blockName}" is ${Array.isArray(value) ? "an array" : typeof value}, not an object; no package was read from it`,
            });
            continue;
          }
          for (const [name, version] of Object.entries(value as Record<string, unknown>)) {
            // A LIST, not a map keyed by name. A package declared in two blocks of one manifest is
            // two declarations with two lines and two versions — which is the shape the `field`
            // label exists to describe — where a map would have kept whichever block was read last
            // and thrown the other away. It also removes an old hazard: object keys that look like
            // array indices are enumerated before string keys, so a package named `0` used to move
            // to the front of its manifest's declarations for no reason a reader could see.
            declaredHere.push({
              name,
              version: typeof version === "string" ? version : String(version),
              field: blockName,
              ecosystem: "npm",
            });
          }
        }

        for (const { name, version, field, ecosystem } of declaredHere) {
          // EVERY declaration is kept, not only the first, and now in two directions: every manifest
          // that declares the name (a monorepo pins one package at two versions in two workspaces,
          // and an inventory that shows one of them states as a fact about the product something
          // true of half of it) and every block of one manifest that declares it.
          const declaration: PackageDeclaration = {
            file,
            // Located by BLOCK AND NAME: the `devDependencies` line naming the same package is not
            // the citation for the `dependencies` declaration, and since 2026-08-28 both exist.
            line: keyLines.get(blockKey(field, name)) ?? 1,
            version,
            field,
            ecosystem,
          };
          const existing = declaredPackages.get(name);
          if (existing) existing.push(declaration);
          else declaredPackages.set(name, [declaration]);
        }
      } catch (e) {
        // **A `package.json` the census cannot parse is recorded, not swallowed.** Until
        // 2026-08-28 this branch dropped the failure with a comment, so the inventory went out as
        // `[]` with nothing anywhere saying why: a tree whose only manifest carries a UTF-8 BOM —
        // which npm itself accepts — produced the identical document to a tree with no npm
        // manifest, while `dependency_inventory`'s own description told the reader that an empty
        // inventory is a statement about npm manifests. That is a forbidden state one
        // level down. Found by independent verification, 2026-08-28, which also measured
        // the population: of the 3,507 `package.json` files in the 98-tree corpus, 0 carry a BOM
        // and 0 fail `JSON.parse`, so this list is empty on every tree read so far.
        manifestsNotUsable.push({
          file,
          reason: "parse-failed",
          detail: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        });
      }
      continue;
    }

    const ext = extensionOf(file);
    if (over("comment-blanking")) continue files;
    const viewed = commentView(base, content);
    // Not charged, as in the engine: the kind reading has its own allowance (E5).
    fileStartedAt += viewed.kindReadingMs;
    const stripped = viewed.view;
    if (over("line-split")) continue files;
    const originalLines = content.split(/\r?\n/);
    const strippedLines = stripped.split(/\r?\n/);

    /* Import specifiers, for the dependency collector's second pass.
     *
     * **Ungated since 2026-09-03, along with the collectors.** The `CODE_EXTS` test here was the
     * same extension judgement, in the place where it does the most harm: `call_site_count` is what
     * separates a package the product USES from one it merely declares, and `declared_only` — the
     * one marker in this file whose job is to prevent a false accusation — is computed from it. A
     * call site in a `.dart`, a `.m`, a `.mts` under an unlisted name or a Swift file was invisible,
     * so the package it imports was marked "declared and called from nowhere", which is a false
     * statement about the developer's own code.
     *
     * The two families are kept apart because they answer to different manifests:
     * `IMPORT_PATTERNS` reads the JS/TS specifier and `packageOf` normalises it to an npm package
     * name; `MODULE_IMPORT_PATTERNS` reads a Swift/Objective-C module import and is resolved against
     * the SwiftPM and CocoaPods declarations by `MODULE_ALIASES`. Both now run over every readable
     * file, and a specifier that means nothing to either produces nothing. */
    // The lines past the ceiling of a file the import pass reads are lines a call site could be on.
    if (ceiling.blanked.length > 0) {
      callSiteLinesNotRead += ceiling.blanked.length;
      callSiteFilesNotRead.add(file);
    }
    let sinceClock = CENSUS_CLOCK_CHARS;
    for (let i = 0; i < strippedLines.length; i++) {
      if (sinceClock >= CENSUS_CLOCK_CHARS) {
        sinceClock = 0;
        if (over("imports", { read: i, total: strippedLines.length })) continue files;
      }
      sinceClock += strippedLines[i].length + 1;
      for (const re of IMPORT_PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(strippedLines[i])) !== null) {
          const pkg = packageOf(m[1]);
          if (!pkg) continue;
          const sites = importSites.get(pkg) ?? [];
          sites.push({ file, line: i + 1, line_text: lineTextOf(originalLines[i] ?? "") });
          importSites.set(pkg, sites);
        }
      }
      for (const re of MODULE_IMPORT_PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(strippedLines[i])) !== null) {
          const mod = m[1];
          if (!mod) continue;
          const sites = moduleImportSites.get(mod) ?? [];
          sites.push({ file, line: i + 1, line_text: lineTextOf(originalLines[i] ?? "") });
          moduleImportSites.set(mod, sites);
        }
      }
    }

    importsRead = true;

    for (const collector of COLLECTORS) {
      // The first reading of every collector is unconditional, as the first of every rule is in the engine.
      sinceClock = CENSUS_CLOCK_CHARS;
      for (let i = 0; i < strippedLines.length; i++) {
        const line = strippedLines[i];
        if (sinceClock >= CENSUS_CLOCK_CHARS) {
          sinceClock = 0;
          if (over(`collector:${collector.name}`, { read: i, total: strippedLines.length })) continue files;
        }
        sinceClock += line.length + 1;
        if (line.length === 0) continue;
        const seen = new Set<string>();
        for (const re of collector.patterns) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(line)) !== null) {
            const value = collector.value(m);
            if (!value) continue;
            let kind = typeof collector.kind === "string" ? collector.kind : collector.kind(m);

            // A release command written in a document is a statement about the product, not a
            // step that runs. Same fact, different kind — never a dropped hit.
            if (collector.name === "distribution" && kind === "release_automation" && isDocumentaryFile(ext)) {
              kind = "release_documented";
            }

            // **The same rule for a billing call site, added 2026-08-03 with the widened patterns
            // that made it necessary.** `subscription_route` is the one kind allowed to settle the
            // limb that closes the CRA gate, and it means "this product performs a billing
            // operation". A Stripe call inside a fenced code block in a documentation guide is a
            // billing call site in the *text*, teaching a reader how to write one; it is not this
            // product charging a price. Measured the day the widening was made: one tree reached
            // `applies` on a line of its documentation and another on
            // a line of its webhook guide, and in both trees that documentation snippet
            // was the ONLY billing call the collector could find.
            //
            // Nothing is dropped. The hit becomes `commercial_documented` — the kind that says a
            // vendor appears here without claiming a payment happens here — which
            // `price-charged-for-the-product` reads and prints. The reader still sees the line and
            // still answers the limb; the collector no longer answers it for them off a tutorial.
            if (collector.name === "commercial-signals" && kind === "subscription_route" && isDocumentaryFile(ext)) {
              kind = "commercial_documented";
            }

            // **The same rule for a sensitive-capability API, added 2026-09-03** (MODERATE 2 of the
            // independent verification). A class name written in a README, a CHANGELOG or a release
            // note is a statement ABOUT the application — `The app historically used
            // CLLocationManager but no longer does.` — and calling that a runtime REQUEST asserts
            // the opposite of what the line says. `permissionKind` already routes a bare name that
            // is not used as a symbol here; this catches the other half, a code-shaped snippet
            // inside a fenced block in a document, which reads as a symbol and still is not one that
            // runs. Nothing is dropped, and no gate limb consults any `ios_permission_*` kind.
            if (collector.name === "permission-apis" && kind.startsWith("ios_permission_requested_") && isDocumentaryFile(ext)) {
              kind = `ios_permission_documented_${kind.slice("ios_permission_requested_".length)}`;
            }

            // A vocabulary name is not a destination. Counted, not silently dropped.
            if (collector.name === "outbound-hosts" && IDENTIFIER_HOSTS.has(value.toLowerCase())) {
              identifiersNotRequests++;
              continue;
            }
            // A bare quoted string is a host only if it ends in a top-level name, and only if it is
            // not the argument of a translation call.
            if (kind === "host_literal") {
              const tail = value.slice(value.lastIndexOf(".") + 1).toLowerCase();
              if (!HOST_TLDS.has(tail)) continue;
              if (precededByTranslationCall(line, m.index)) continue;
              if (isPropertyName(line, m.index, m.index + m[0].length)) continue;
              if (isLookupKey(line, m.index, m.index + m[0].length)) continue;
            }

            const dedupe = `${kind}|${value}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);
            const lineText = lineTextOf(originalLines[i] ?? "");
            facts.push({
              fact_id: factId(collector.name, kind, file, i + 1, value),
              collector: collector.name,
              kind,
              categories: collector.categories,
              value,
              file,
              line: i + 1,
              line_text: lineText,
              depends_on_runtime_config: envOnLine(line),
            });
            byCollector[collector.name] = (byCollector[collector.name] ?? 0) + 1;
            matchedFiles.add(file);
            // A zero-length match cannot happen with these patterns, but a runaway loop here
            // would hang a scan, so advance defensively.
            if (m.index === re.lastIndex) re.lastIndex++;
          }
        }
      }
    }
    if (budgetOn) censusElapsed.set(file, performance.now() - fileStartedAt);
  }

  // The unpublishable manifests, shallowest first, capped. See MARKED_NOT_PUBLISHED above.
  const depth = (p: string) => p.split("/").length;
  for (const n of [...notPublished].sort((a, b) => depth(a.file) - depth(b.file) || a.file.localeCompare(b.file)).slice(0, MARKED_NOT_PUBLISHED_CAP)) {
    facts.push({
      fact_id: factId("distribution", MARKED_NOT_PUBLISHED, n.file, n.line, n.value),
      collector: "distribution",
      kind: MARKED_NOT_PUBLISHED,
      categories: ["distribution"],
      value: n.value,
      file: n.file,
      line: n.line,
      line_text: lineTextOf(n.text),
      depends_on_runtime_config: [],
    });
    byCollector["distribution"] = (byCollector["distribution"] ?? 0) + 1;
    matchedFiles.add(n.file);
  }

  /* Module imports resolved into package call sites, after every manifest has been read.
   *
   * **A Swift `import X` names a MODULE, and no rule turns a module name into a package identity** —
   * `firebase-ios-sdk` supplies `FirebaseCrashlytics`, `swift-collections` supplies
   * `OrderedCollections`, `GRDB.swift` supplies `GRDB`. The join is made only where a manifest in
   * this tree STATES it (`.product(name:package:)`, an XcodeGen `- package:`/`product:` pair, a
   * CocoaPods subspec) or where the module name IS the identity. An import this table cannot place
   * is left where it is: it adds no call site to any package, so it can never move a package out of
   * `declared_only` on a guess.
   *
   * The resolved sites are folded into `importSites`, the same map the npm specifiers write to, so
   * one inventory pass serves both families and neither can drift from the other. */
  // XcodeGen's cross-file product mapping, joined now that every manifest has been read.
  for (const [alias, product] of xcodeGenProductPairs) {
    const identity = xcodeGenAliases.get(alias);
    if (identity) noteAlias(product, identity);
  }

  const gainedModuleSites = new Set<string>();
  for (const [module, sites] of moduleImportSites) {
    const owners = moduleAliases.get(normaliseModuleName(module));
    if (!owners) continue;
    for (const owner of owners) {
      const existing = importSites.get(owner) ?? [];
      existing.push(...sites);
      importSites.set(owner, existing);
      gainedModuleSites.add(owner);
    }
  }
  // Only the lists this pass touched are re-sorted, and they are sorted rather than appended to
  // because the fact a package produces cites `sites[0]` — which has to be the first call site in
  // the tree, not the first one this loop happened to reach. Every list the npm pass alone filled is
  // left in walk order exactly as it was.
  for (const owner of gainedModuleSites) {
    importSites.get(owner)!.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  }

  // The dependency collector: a package is a fact only where something imports it.
  const declared_only_dependencies: DeclaredOnlyDependency[] = [];
  /**
   * The inventory. **One row per declared package, whichever side of the call-site line it falls
   * on**, which is the whole point of it: the two populations above are emitted in two places and a
   * reader who has only one of them cannot tell "this package is not declared" from "this package
   * is declared and called from nowhere". Both are facts and both travel, each marked as what it is.
   *
   * **And whichever of the four manifest blocks declares it**, since a ruling of
   * 2026-08-28 — one `declared[]` entry per declaration, each labelled with its `field`, so a
   * package declared in `dependencies` and again in `devDependencies` carries both lines and both
   * versions. This array is the only one of the three that widened; see
   * `RUNTIME_DEPENDENCY_BLOCKS` for what still turns on the two runtime blocks and why.
   *
   * Nothing here is a conclusion. There is no severity, no confidence, no vendor classification and
   * no field that says a finding is real — for the reason `SKILL.md` step 4 withholds `severity` and
   * `rule_confidence` from an adjudicator: a detector's opinion handed over before the file is
   * opened anchors the judgement it was supposed to inform. What a declaration and a call site do
   * and do not establish is stated where the inventory is handed on, not decided here.
   */
  const dependency_inventory: DependencyInventoryEntry[] = [];
  let withCallSites = 0;
  // The counts every entry that claims no call site carries where they are not zero (see where they are
  // counted). One object for the tree: a line not read could hold the call site of any package.
  const callSitesNotRead: CallSitesNotRead | null =
    callSiteFilesNotRead.size > 0 ? { lines_past_ceiling: callSiteLinesNotRead, files: callSiteFilesNotRead.size } : null;
  let declaredOnlyNotRead = 0;
  // **Ordered by CODE UNIT, not by `localeCompare`.** `localeCompare` with no locale argument
  // collates in the runtime's DEFAULT LOCALE, which is a property of the machine and not of the
  // tree: under `en-US` it orders `commander` before `Mixpanel-Browser`, and a code-unit comparison
  // orders them the other way, because `M` is 0x4D and `c` is 0x63. The same correction was made to
  // `scan_anchor` in `scan.ts` for the same property — the same tree must produce the same document
  // on every machine. **Measured before the change and it moves nothing**: over the eight pinned
  // pass-1 trees, 244 inventory entries, the two orderings agree on all eight documents, because npm
  // package names are conventionally lower-case. It is made for the property, not for an observed
  // difference — and it is made here rather than only on the new array, so that this document does
  // not carry two arrays of the same packages in two different orders.
  let runtimeDeclared = 0;
  for (const [name, declarations] of [...declaredPackages.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )) {
    const sites = importSites.get(name) ?? [];
    dependency_inventory.push({
      package: name,
      declared: declarations,
      // Exact, and computed BEFORE any truncation. `call_sites` below is a sample of this; a reader
      // who compares the two lengths is reading the cap, never a smaller census.
      call_site_count: sites.length,
      // Always present, never omitted when false. `call_site_count: 0` says the same thing, and a
      // marker that appears only on one branch cannot be told apart from a scanner that stopped
      // writing it — the reason `suppressed_by_corroboration` and `files_not_read` are emitted
      // empty. This is the anti-false-accusation half of the record and it is the last field that
      // should have to be inferred.
      declared_only: sites.length === 0,
      ...(sites.length > 0
        ? { call_sites: sites.slice(0, inventoryExamples).map((s) => ({ file: s.file, line: s.line })) }
        : {}),
      // No call site found, and lines that could hold one not read: whether it is imported is NOT KNOWN.
      ...(sites.length === 0 && callSitesNotRead ? { call_sites_not_read: { ...callSitesNotRead } } : {}),
    });
    // **The three narrower populations below are the RUNTIME declarations of this package.** The
    // inventory above carries all four blocks; `facts`, `declared_only_dependencies` and
    // `stats.packages_declared` carry the two runtime ones, because a `facts` dependency row is
    // categorised `recipients` and promoting a build-time package into it would change what the
    // scanner detects — a different decision from the one taken on 2026-08-28, which was about what
    // the inventory carries. A package declared ONLY in `devDependencies` or `peerDependencies`
    // therefore has an inventory entry, with `field` saying so, and no row in either of the others.
    const runtimeDeclarations = declarations.filter((d) => RUNTIME_DEPENDENCY_BLOCK_SET.has(d.field));
    if (runtimeDeclarations.length === 0) continue;
    runtimeDeclared++;
    if (sites.length === 0) {
      // The FIRST RUNTIME declaration, which is the first `dependencies` line where a manifest has
      // one — not simply the first declaration, which since 2026-08-28 may be a `devDependencies`
      // one for a package some other manifest declares at runtime.
      declared_only_dependencies.push({
        package: name,
        version: runtimeDeclarations[0].version,
        declared_in: runtimeDeclarations[0].file,
        ...(callSitesNotRead ? { call_sites_not_read: { ...callSitesNotRead } } : {}),
      });
      if (callSitesNotRead) declaredOnlyNotRead++;
      continue;
    }
    withCallSites++;
    /* The site the FACT cites: the first one that is not in a document, and the first one otherwise.
     *
     * **A preference, never a filter.** `call_site_count` is unchanged, every site stays in
     * `call_sites[]`, and a package whose only call sites are documentary still produces its fact —
     * this chooses which line a reader is sent to first, and nothing else.
     *
     * Added 2026-09-03 with the ungating of the import pass, which made it necessary: one tree's
     * HTML-packing package has a real TypeScript import in
     * an exporter module and a documented one inside
     * a fenced ```javascript block in its README, and the README sorts earlier
     * in walk order. A `recipients` fact whose citation is a usage example in documentation is a
     * worse statement about the same true package than the same fact citing the call. */
    const first = sites.find((s) => !isDocumentaryFile(extensionOf(s.file))) ?? sites[0];
    facts.push({
      fact_id: factId("dependencies", "dependency", first.file, first.line, name),
      collector: "dependencies",
      kind: "dependency",
      categories: ["recipients"],
      value: name,
      file: first.file,
      line: first.line,
      line_text: first.line_text,
      depends_on_runtime_config: [],
      call_sites: sites.slice(0, callSiteLimit),
    });
    byCollector["dependencies"] = (byCollector["dependencies"] ?? 0) + 1;
    matchedFiles.add(first.file);
  }

  facts.sort(
    (a, b) =>
      a.collector.localeCompare(b.collector) ||
      a.value.localeCompare(b.value) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );

  /* The outbound-host corroboration pass. See REQUEST_CONSTRUCTS above for what this is and what it
   * deliberately is not. It runs after the sort so `fact_ids` come out in the emitted order, and it
   * re-reads through the caller's own `readFile`, which is the run's shared cache in every real
   * caller — so a file already opened by the collectors costs nothing to look at again. */
  const outboundByFile = new Map<string, { ids: string[]; values: Set<string> }>();
  for (const f of facts) {
    if (f.collector !== "outbound-hosts") continue;
    const entry = outboundByFile.get(f.file) ?? { ids: [], values: new Set<string>() };
    entry.ids.push(f.fact_id);
    entry.values.add(f.value);
    outboundByFile.set(f.file, entry);
  }
  const outboundNoRequest: OutboundHostFileWithoutRequestConstruct[] = [];
  for (const [file, entry] of [...outboundByFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // A file the census already stopped on is named in `files_stopped_for_time`, which covers this pass too.
    if (stoppedFiles.has(file)) continue;
    // The same file's budget, charged with what the census already spent on it.
    let startedAt = budgetOn ? performance.now() - (censusElapsed.get(file) ?? 0) : 0;
    const spent = (): boolean => {
      if (!budgetOn) return false;
      const elapsed = performance.now() - startedAt;
      if (elapsed < budgetMs) return false;
      stoppedFiles.add(file);
      stoppedForTime.push({ file, stage: "request-construct", budget_ms: Math.round(budgetMs), elapsed_ms: Math.round(elapsed) });
      return true;
    };
    if (spent()) continue;
    const read = opts.readFile(file);
    // A file that cannot be re-read is NOT reported as carrying no request construct. "We could not
    // look" and "we looked and found none" are different sentences and only one of them is true.
    if (read === null) continue;
    // The same line ceiling as the collectors read through; its lines are already named.
    if (spent()) continue;
    const ceilingRc = blankLongLines(read);
    const text = ceilingRc.text;
    // Comments stripped first (LOW 3 of the 2026-09-02 verification): a `// we fetch(...) nothing
    // here` comment must not credit a file with a request construct it does not have, which would
    // leave a noise file un-annotated — the silent direction. The rest of the census already reads
    // this stripped form; the annotation now does too.
    if (spent()) continue;
    const viewed = commentView(file, text);
    startedAt += viewed.kindReadingMs;
    const carries = requestConstructOrSpent(viewed.view, spent);
    // null: the budget was spent before every construct was tried; the file is named as stopped, not as carrying none.
    if (carries !== false) continue;
    outboundNoRequest.push({
      file,
      facts: entry.ids.length,
      distinct_values: entry.values.size,
      fact_ids: [...entry.ids].sort(),
      test_or_fixture_file: isTestOrFixturePath(file),
      // "No request construct anywhere in the file" over lines past the ceiling is not known: they are counted.
      ...(ceilingRc.blanked.length > 0 ? { long_lines_not_read: ceilingRc.blanked.length } : {}),
    });
  }

  return {
    facts,
    declared_only_dependencies,
    dependency_inventory,
    ...(manifestsNotUsable.length > 0 ? { manifests_not_usable: manifestsNotUsable } : {}),
    ...(stoppedForTime.length > 0 ? { files_stopped_for_time: stoppedForTime } : {}),
    ...(longLinesNotRead.length > 0 ? { files_long_lines_not_read: longLinesNotRead } : {}),
    outbound_hosts_without_a_request_construct: outboundNoRequest,
    stats: {
      files_read: filesRead,
      files_matched: matchedFiles.size,
      by_collector: byCollector,
      // The RUNTIME population, not the inventory's length: this minus `packages_with_call_sites`
      // is `declared_only_dependencies.length`, an identity two schema descriptions promise a
      // consumer can check. Since 2026-08-28 `dependency_inventory` is longer than this on most npm
      // trees, by exactly the packages only `devDependencies` or `peerDependencies` declares.
      packages_declared: runtimeDeclared,
      packages_with_call_sites: withCallSites,
      // Of `declared_only_dependencies`, those whose call sites could be on lines not read; only when any.
      ...(declaredOnlyNotRead > 0 ? { packages_declared_only_not_read: declaredOnlyNotRead } : {}),
      identifiers_not_requests: identifiersNotRequests,
      manifests_marked_not_published: notPublished.length,
      // Emitted only when it fired, on the same asymmetry `manifests_not_usable` is emitted on: in
      // the shipped pipeline the walker has already applied the identical NUL test, so this is 0 on
      // every real tree and an unconditional 0 would rewrite two golden census documents to report a
      // refusal nothing ever made.
      ...(filesNotText > 0 ? { files_not_text: filesNotText } : {}),
    },
  };
}
