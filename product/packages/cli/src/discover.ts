/**
 * Declaration discovery — locating the developer's own legal documents inside their repository.
 *
 * This is layer 1 of pillar 2 (declaration reconciliation) and it has exactly one job: hand the
 * agent every document that might be a declaration, and say what was looked at. It classifies
 * nothing. A page that turns out to be a marketing blurb costs the agent one read; a policy the
 * tool never found costs the user a finding they will never see, and the tool will say nothing at
 * all — the same asymmetry that removed `detector.guard_missing` and the walker's hidden exclusion.
 *
 * Three passes, because one is not enough:
 *
 * 1. **Globs** — the four patterns the plan fixes: `**\/privacy*`, `**\/terms*`, `**\/legal/*`,
 *    `**\/*policy*`, tested against the path *and*, for a router file, against its directory's path
 *    (see `identityPaths` — written as file-name globs they find nothing at all in an app router).
 *    Measured that way against the eight real documents of the owner's application, these four find
 *    **four**: the privacy policy and terms of service in each language. The content terms, the
 *    advertising disclosure, the community guidelines and the Specified Commercial Transactions Act
 *    notice match none of them. **From 2026-09-02 this pass is EXTENSION-AGNOSTIC**: every walked
 *    path is tested, whatever it is called after the last dot — see `DOCUMENT_FORMAT_EXTS` for the
 *    ruling and for what the extension list is still allowed to do.
 *
 * 2. **Siblings** — Next.js and every router like it name the route by the directory and the file
 *    by its role, so a repository's legal documents are `X/page.tsx`, `Y/page.tsx`, `Z/page.tsx`
 *    under one parent. Once a glob has found one of them, its neighbours are the rest of the set.
 *    This is the pass that reaches the other four, and it is an addition to the plan's component 1
 *    rather than a restatement of it.
 *
 * 3. **References** — files that point at a document without being one. The trial's most
 *    interesting finding came from a version log recording "added geolocation collection to
 *    Article 3" when neither language's Article 3 contains any such item. That file is named
 *    `versions.ts`, is written like code, and matches no glob any policy-finder would write. It is
 *    reachable only from the documents it names.
 *
 * 4. **Content** — files that read like a legal document whatever they are called. Passes 1–3 are
 *    all name-derived: a glob on the name, the neighbours of a name, the references to a name. A
 *    repository whose policy is `src/pages/Legalese.tsx`, or `content/en/notice-v3.mdx`, or simply
 *    `About.tsx` with the policy inside it, defeats all three at once — and the tool would then
 *    report nothing, which is the single worst thing this product can do. This pass reads every
 *    file that could hold prose and scores it on what a privacy notice or a set of terms actually
 *    says, in the languages the packs cover. It is the only pass that does not care what anything
 *    is called. **From 2026-09-02 it also asks whether the file reads like a document at all** — a
 *    confirming clause beside the marker threshold and not a narrower threshold; see
 *    `measureContentShape` for why the obvious repair was not taken, and for what a screened file
 *    still gets.
 *
 * What was searched is reported next to what was found (`looked_at`), on the same principle as
 * `excluded_by_walker`: **a document the tool failed to find must not look like a document that
 * does not exist.** Discovery is never presented as complete: the output says how many files were
 * read and by which route each document was reached, so that "we found three" is legible as
 * "these three were reachable", not as "there are three".
 */

import type {
  ContentMatch,
  ContentShape,
  DiscoveredDoc,
  DiscoveryResult,
  FoundBy,
  ReferencingFile,
  SiblingExpansion,
  SiblingNotAddedReason,
} from "wolfboy-schemas";
import { compileGlobs, globsAllow, type CompiledGlobs } from "./globs.js";
import { NAMED_IN_FULL, decodedTextIsBinary, shownText } from "./walk.js";

export type { ContentMatch, ContentShape, DiscoveredDoc, DiscoveryResult, FoundBy, ReferencingFile, SiblingExpansion, SiblingNotAddedReason };

/** The four glob patterns fixed by the plan. Lowercased paths are matched, so case never decides. */
export const DECLARATION_GLOBS = [
  "**/privacy*",
  "**/terms*",
  "**/legal/*",
  "**/*policy*",
  // The separator companions of the four words above, added 2026-09-02 for a hole one real run found.
  //
  // **What was missed.** a store-metadata privacy page — a third, near-verbatim copy of one tree's own
  // privacy table, served as the in-app first-run onboarding screen — was reached by no pass at all:
  // not by name, not by content, not even as a reference. `**/privacy*` compiles to an ANCHORED
  // pattern (`globs.ts`), so the final path component has to *start with* `privacy`, and this file's
  // ordinal prefix (it is screen 5 of a numbered sequence) puts one character in front of the word.
  // The content pass could not rescue it either: the file matches one marker of the three it needs.
  //
  // **This is the same defect the EU-language block below already fixed for its own words**, and the
  // same repair: a compound legal-page name is separator-joined, never concatenated, so each word
  // gets a pattern at the start of a path segment AND one after a separator, and a word buried
  // inside another word matches neither. a word such as `fastermost` still matches nothing (no separator before
  // `terms`); `5_privacy.md`, `app-privacy.md` and `2.terms.md` now do. Written here rather than as
  // a looser `**/*privacy*` for exactly the reason recorded there: contains-style patterns took one
  // repository from 117 documents to 422.
  //
  // Deliberately NOT given a companion: `readme*` and `security*` (root-anchored on purpose — see
  // their own comment), `**/*policy*`, `**/*subprocessor*` and `**/*sub-processor*` (already
  // contains-style, so a separator adds nothing), `**/legal/*` and `**/.well-known/*` (directory
  // patterns, not word patterns).
  "**/*{-,_,.}privacy*",
  "**/*{-,_,.}terms*",
  // Added 2026-07-28 for the DECL rows of the EU coverage map.
  // A declaration is not only a privacy notice: the DSA requires an operator-identification page,
  // the EAA an accessibility statement, the Data Act a published statement of which jurisdiction
  // the infrastructure sits in. Each of those is a document with a conventional name, and none of
  // the four original globs reaches any of them.
  //
  // Chosen for words that name a legal document and almost nothing else. `imprint` and `impressum`
  // are the EU's own names for the operator page; `subprocessor` appears in nothing but a
  // disclosure. Deliberately NOT added: `contact*`, `security*` and `pricing*`, which name ordinary
  // source files in every second repository — those documents are reached by the content pass
  // below, which reads what a file says instead of what it is called.
  "**/imprint*",
  "**/*{-,_,.}imprint*",
  "**/impressum*",
  "**/*{-,_,.}impressum*",
  "**/accessibility*",
  "**/*{-,_,.}accessibility*",
  "**/*subprocessor*",
  "**/*sub-processor*",
  "**/.well-known/*",
  // App Store Connect / Play Console metadata pointers, added 2026-09-03 (hole 9 of the
  // run on an iOS tree). `fastlane`'s metadata directories carry one file per store field, each
  // holding one line; `privacy_url.txt` was already reached by `**/privacy*`, and its two siblings
  // were not.
  //
  // **`support_url.txt` is what DSA Article 12 asks about** — a single point of contact for
  // recipients of the service — and on the run that found this it had to be read out of the corpus
  // BY HAND, outside the batch's assigned document set, because no glob reached it. `marketing_url`
  // is its neighbour in the same directory with the same shape.
  //
  // Written as full filenames rather than as `**/*support*` or `**/*contact*`, deliberately and for
  // the reason the EU-language block below records: contains-style patterns took one repository from
  // 117 documents to 422, and `support` and `contact` name ordinary source files in every second
  // repository. These two are Apple's and Google's own field names, and they name almost nothing
  // else. Both separator companions are given, so `fastlane/en-US/support_url.txt` and a
  // `2.support_url.txt` are both reached.
  "**/support_url*", "**/*{-,_,.}support_url*",
  "**/marketing_url*", "**/*{-,_,.}marketing_url*",
  // Root-level product documentation, added 2026-07-28 for Part C row 7 (CRA Annex II). That row's
  // documents are not legal pages at all — the information that must accompany a product lives in
  // a README, a SECURITY file or a store listing — and the fixture for it discovered one document
  // out of four until these two patterns existed. **Root-anchored on purpose**: written `**/README*`
  // they would match every README in every subdirectory of a monorepo, and the point is the one
  // that describes the product being shipped.
  "readme*",
  "security*",
  // The names EU legal pages actually carry, added 2026-07-28 after adversarial verification.
  // Measured before this line existed: a Polish `regulamin` / `polityka-prywatnosci`, a French
  // `mentions-legales`, a Spanish `aviso-legal` and an Italian `note-legali` — full legal pages,
  // one of them carrying a correct DSA contact point — produced **zero** discovered documents,
  // because every glob and almost every content marker was English or German. For an EU pack whose
  // instruments bind all 27 Member States, that is the asymmetry this project is written against:
  // no document found reads exactly like a document that says nothing.
  // Token-boundary patterns, NOT contains-style. Written first as `**/*word*`, which reintroduced
  // the exact noise it was meant to remove, larger: `**/*termos*` matches any word ending in **-termost**, and
  // one chat product's repository went from about a hundred reported documents to four hundred — sixty icon components
  // among them — because sibling expansion multiplies every glob hit. Measured and caught by the
  // third verification round, 2026-07-28.
  //
  // The fix rests on how real slugs are built: a compound legal-page name is separator-joined
  // (`algemene-voorwaarden`, `obchodni-podminky`, `politika-tal-privatezza`), never concatenated.
  // So each word gets two patterns — at the start of a path segment, and after a separator — and
  // a word buried inside another word (`deterministic`) matches neither.
  "**/regulamin*", "**/*{-,_,.}regulamin*", // pl
  "**/polityka*", "**/*{-,_,.}polityka*", // pl
  "**/mentions-legales*", "**/*{-,_,.}mentions-legales*", // fr
  "**/mentions-légales*", "**/*{-,_,.}mentions-légales*", // fr
  "**/confidentialite*", "**/*{-,_,.}confidentialite*", // fr
  "**/confidentialité*", "**/*{-,_,.}confidentialité*", // fr
  "**/conditions-generales*", "**/*{-,_,.}conditions-generales*", // fr
  "**/conditions-générales*", "**/*{-,_,.}conditions-générales*", // fr
  "**/conditions-utilisation*", "**/*{-,_,.}conditions-utilisation*", // fr
  "**/conditions-dutilisation*", "**/*{-,_,.}conditions-dutilisation*", // fr
  "**/conditions-d-utilisation*", "**/*{-,_,.}conditions-d-utilisation*", // fr
  "**/aviso-legal*", "**/*{-,_,.}aviso-legal*", // es
  "**/privacidad*", "**/*{-,_,.}privacidad*", // es
  "**/condiciones*", "**/*{-,_,.}condiciones*", // es
  "**/note-legali*", "**/*{-,_,.}note-legali*", // it
  "**/condizioni*", "**/*{-,_,.}condizioni*", // it
  "**/termini*", "**/*{-,_,.}termini*", // it/mt
  "**/voorwaarden*", "**/*{-,_,.}voorwaarden*", // nl
  "**/privacyverklaring*", "**/*{-,_,.}privacyverklaring*", // nl
  "**/termos*", "**/*{-,_,.}termos*", // pt
  "**/villkor*", "**/*{-,_,.}villkor*", // sv
  "**/integritetspolicy*", "**/*{-,_,.}integritetspolicy*", // sv
  "**/betingelser*", "**/*{-,_,.}betingelser*", // da
  "**/persondatapolitik*", "**/*{-,_,.}persondatapolitik*", // da
  "**/privatlivspolitik*", "**/*{-,_,.}privatlivspolitik*", // da
  "**/kayttoehdot*", "**/*{-,_,.}kayttoehdot*", // fi
  "**/käyttöehdot*", "**/*{-,_,.}käyttöehdot*", // fi
  "**/tietosuoja*", "**/*{-,_,.}tietosuoja*", // fi
  "**/podminky*", "**/*{-,_,.}podminky*", // cs
  "**/podmínky*", "**/*{-,_,.}podmínky*", // cs
  "**/podmienky*", "**/*{-,_,.}podmienky*", // sk
  "**/pogoji*", "**/*{-,_,.}pogoji*", // sl
  "**/uvjeti*", "**/*{-,_,.}uvjeti*", // hr
  "**/termeni*", "**/*{-,_,.}termeni*", // ro
  "**/feltetelek*", "**/*{-,_,.}feltetelek*", // hu
  "**/feltételek*", "**/*{-,_,.}feltételek*", // hu
  "**/adatvedelmi*", "**/*{-,_,.}adatvedelmi*", // hu
  "**/adatvédelmi*", "**/*{-,_,.}adatvédelmi*", // hu
  "**/adatkezelesi*", "**/*{-,_,.}adatkezelesi*", // hu
  "**/adatkezelési*", "**/*{-,_,.}adatkezelési*", // hu
  "**/tingimused*", "**/*{-,_,.}tingimused*", // et
  "**/noteikumi*", "**/*{-,_,.}noteikumi*", // lv
  "**/salygos*", "**/*{-,_,.}salygos*", // lt
  "**/sąlygos*", "**/*{-,_,.}sąlygos*", // lt
  "**/tearmai*", "**/*{-,_,.}tearmai*", // ga
  "**/tearmaí*", "**/*{-,_,.}tearmaí*", // ga
  "**/téarmaí*", "**/*{-,_,.}téarmaí*", // ga
  "**/priobhaideachais*", "**/*{-,_,.}priobhaideachais*", // ga
  "**/príobháideachais*", "**/*{-,_,.}príobháideachais*", // ga
  "**/privatezza*", "**/*{-,_,.}privatezza*", // mt
  // Languages that build compounds with no separator — Estonian, Finnish, German — need the whole
  // word, because neither a segment-start nor an after-separator pattern can reach a fragment
  // welded into the middle of one: `kasutustingimused` is `kasutus` + `tingimused`. Listed in full
  // and only where the compound is long and distinctive enough not to appear inside ordinary source.
  "**/kasutustingimused*", "**/*{-,_,.}kasutustingimused*", // et
  "**/privaatsuspoliitika*", "**/*{-,_,.}privaatsuspoliitika*", // et
  "**/nutzungsbedingungen*", "**/*{-,_,.}nutzungsbedingungen*", // de
  "**/datenschutzerklarung*", "**/datenschutzerklärung*", // de
  "**/*{-,_,.}datenschutzerklarung*", "**/*{-,_,.}datenschutzerklärung*", // de
  "**/geschaftsbedingungen*", "**/geschäftsbedingungen*", // de
  "**/*{-,_,.}geschaftsbedingungen*", "**/*{-,_,.}geschäftsbedingungen*", // de
  "**/lietosanas-noteikumi*", "**/lietošanas-noteikumi*", // lv
];

/**
 * The conventional document formats. **This list decides nothing. It is a COST label, never a
 * judgement**, and it is kept only so a reader can see the format mix of a tree at a glance.
 *
 * **The extension does not matter**: judging by extension means nothing — a file
 * extension is meaningless AS EVIDENCE of whether something is a declaration document, and every
 * place an extension acted as a judgement is removed. What may survive is (a) a physical-readability
 * filter, which is a statement about bytes and not about meaning, and (b) display and cost
 * clustering, which decides nothing about any file.
 *
 * **What it cost while it was a filter.** Until this ruling the list above named the only extensions
 * the NAME passes would test. One tree's own Terms and Privacy Policy for its paid hosted tier are
 * `packages/server/src/routes/index/terms.ts` and `.../privacy.ts` — names that match `**\/terms*`
 * and `**\/privacy*` exactly, whose entire function body is a rendered Markdown legal document — and
 * pass 1 never tested either of them, because `ts` was not on this list. They were reached by the
 * content pass alone, arrived carrying no name signal at all, and were read past in a 165-line
 * listing; the run then told six of seven subagents that no terms-of-service document existed
 * anywhere in the repository. This is the same defect shape as the walker's old extension allowlist
 * (see `walk.ts`), one level down, and it is repaired the same way: the question is not "is this
 * extension one we recognise?" but "is there a positive reason not to read this file?".
 *
 * The only remaining uses of this constant are `looked_at.extensions` and
 * `looked_at.files_with_declaration_extension`, both of which are reported and neither of which is
 * consulted by any pass.
 *
 * ## What this wave did NOT reach, and what a later one closed
 *
 * **`census.ts` decided from extensions too, and it does not any more.**
 * The note that stood here recorded the gap honestly and left it to the owner, because widening a
 * collector's file surface is a granularity change: `applies: (ext) => CODE_EXTS.has(ext)` was
 * exactly "is this extension one we recognise?", and a Terraform file, a shell script, a `.dart`, a
 * `.m`, a `.lua` or a `.sql` produced no outbound-host fact for that reason alone. All six collector
 * gates and the import pass are gone; what survives an extension test there is `PROSE_EXTS`, which
 * chooses between two KINDS of the same emitted fact and drops nothing, and whose content-measured
 * replacement was built, measured on five trees and rejected — see `isDocumentaryFile` for the
 * numbers.
 *
 * **`store-declarations.ts` still does**, and is left alone: `isXcprivacyPath` is name-as-identity
 * confirmed by parsing, and `isPlayDataSafetyPath` additionally requires `.csv`, so a Play export
 * saved as `.xlsx` or `.tsv` is invisible — `reconcile.ts`'s `STORE_IDENTIFICATION` already grades
 * that signal as the weaker of the two, in the output.
 */
export const DOCUMENT_FORMAT_EXTS = ["md", "mdx", "html", "htm", "tsx", "jsx"];

/**
 * Basenames that identify a file by its role in a router rather than by its content, so the
 * document's identity is its directory. Used when deriving reference keys and sibling roots.
 */
const ROLE_BASENAMES = new Set(["page", "index", "route", "layout", "template", "default"]);

/**
 * Reference keys shorter than this, or in the stoplist, match half a repository and say nothing.
 * A key that is not distinctive produces noise the agent has to dismiss one file at a time.
 */
const MIN_KEY_LENGTH = 6;
const KEY_STOPLIST = new Set([
  "legal", "policy", "policies", "terms", "privacy", "public", "static", "content", "guide", "guides",
  // `readme` names a file by its role, like `page` or `index`, and every repository has many.
  // Measured on the owner's application: taking `README` as a document key produced **60 of the
  // 150 referencing rows**, all of them prompt and documentation files that mention the word, and
  // it pushed the one row that carries a real disagreement — the version log — to eighth place.
  // A key that is not distinctive is not a reference, it is a word.
  "readme", "index", "changelog", "contributing", "security", "license", "licence", "notice",
]);

/**
 * Phrases that a privacy notice or a set of terms contains and ordinary source does not.
 *
 * This is a detector pattern targeting non-English content as well as English, which is the
 * category exempt from the English-only rule — the German and Japanese markers are here
 * because a German privacy notice is the normal case for an EU pack, not a special case.
 *
 * Chosen to be things a document *says*, never things a file is *called*: `personal data`,
 * not `privacy`. A component named `PrivacyPolicy` matches none of these; a page that explains what
 * data is collected matches several whatever it is named.
 */
export const CONTENT_MARKERS: RegExp[] = [
  /\bpersonal data\b/i,
  /\bpersonal information\b/i,
  /\bprivacy (policy|notice|statement)\b/i,
  /\bdata (controller|processor|subject)\b/i,
  /\bdata protection officer\b/i,
  /\bterms (of (service|use)|and conditions)\b/i,
  /\bcookie (policy|notice)\b/i,
  /\b(retention|storage) period\b/i,
  /\b(lawful|legal) basis\b/i,
  // Hyphen-tolerant, corrected 2026-09-02 (L5 of the run-2 verification). The marker's target is the
  // PHRASE "third party", and `third-party` is that phrase with the spelling English technical prose
  // actually prefers — an attributive "third-party services", "a third-party privacy policy". Written
  // with a space only, this entry could not see the commoner form: one tree's privacy table says
  // "third-party services", "a third-party, such as OneDrive" and "the third-party privacy policy
  // applies" and scored ZERO on it, which cost the third copy of that table
  // (`packages/lib/welcomeAssets.js`) its third marker and left it reachable by no pass at all. A rule
  // that is wrong about what it is looking for is corrected at any time, and this widens.
  /\bthird[- ]part(y|ies)\b/i,
  /\bwe (collect|process|retain|share)\b/i,
  /\bsupervisory authority\b/i,
  /\bwithdraw (your )?consent\b/i,
  /個人情報|個人データ/,
  /プライバシーポリシー|プライバシー・?ポリシー/,
  /利用規約|取扱規程|取扱方針/,
  /第三者(への)?提供/,
  /保存期間|保有期間/,
  /開示(請求|等の請求)|訂正・削除/,
  // A declaration is not only a privacy notice. A commercial disclosure, an advertising
  // disclosure and a set of community rules are declarations in exactly the sense this pillar
  // means, and the DSA requires the last of those to state how moderation works.
  //
  // **One concept per entry.** The score counts entries that matched, not phrases, so lumping a
  // document's whole vocabulary into one alternation caps it at one point however often it speaks.
  // Measured: a commercial-disclosure page scored 1 while matching four of the alternatives inside
  // a single entry, and stayed invisible.
  /特定商取引/,
  /販売価格|販売価額|表示価格|利用料金/,
  /返品|キャンセル|解約|中途解約/,
  /事業者(の)?名称|運営(会社|事業者|者)|代表者|所在地/,
  /支払(方法|時期)|引渡(時期|方法)|提供(時期|開始)/,
  /広告(の)?表示|プロモーション|スポンサー/,
  /アフィリエイト|成果報酬|紹介料/,
  /コミュニティ(ガイドライン|ルール)|行動規範/,
  /禁止(事項|行為)/,
  /投稿(の)?(削除|停止)|アカウント(の)?(停止|凍結)/,
  /通報|報告フォーム|違反(の)?報告/,
  /\b(affiliate|sponsored|advertising) (disclosure|programme?|links?)\b/i,
  /\b(community|content) (guidelines|standards|rules)\b/i,
  /\bprohibited (content|conduct|uses?)\b/i,
  /\breport (abuse|content|a violation)\b/i,
  /\b(refund|cancellation|withdrawal) (policy|right|period)\b/i,
  /\b(registered office|company registration|trade register)\b/i,
  // Structure, not topic. A legal document is numbered by article or section, refers to itself
  // ("these terms", the Japanese "hon-kiyaku"), and carries a date it took effect. Those hold across privacy notices,
  // terms, community rules and commercial disclosures alike, which is what makes them worth more
  // than another list of subject words: they reach a document type nobody thought to enumerate.
  /第\s*\d+\s*条/,
  /本(規約|ポリシー|ガイドライン|方針|規程)/,
  /(制定|改定|改訂|施行|最終更新)日/,
  /\b(Article|Section|Clause)\s+\d+\b/,
  /\b(these|this) (terms|policy|agreement|notice|guidelines)\b/i,
  /\b(last updated|effective (date|as of)|in force from)\b/i,
  // The wider EU acquis, added 2026-07-28 with the DECL rows. Each entry is a phrase that appears
  // in the document a specific obligation requires and does not appear in ordinary source: the DSA
  // contact points and terms, the EAA accessibility statement, the CRA product information, the
  // Data Act switching and jurisdiction statements. One concept per entry, for the scoring reason
  // above — the threshold counts entries that matched, not phrases.
  /\bsingle point of contact\b/i,
  /\blegal representative\b/i,
  /\bcontent moderation\b/i,
  /\bstatement of reasons\b/i,
  /\binternal complaint[- ]handling\b/i,
  /\baccessibility statement\b/i,
  /\b(WCAG|Web Content Accessibility Guidelines|EN 301 549)\b/i,
  /\bsupport period\b/i,
  /\bvulnerability (disclosure|reporting|report)\b/i,
  /\bdeclaration of conformity\b/i,
  /\bswitching (charges?|fees?|to another (provider|service))\b/i,
  /\begress (fees?|charges?)\b/i,
  /\bsub-?processors?\b/i,
  // The seven document kinds the nine checklists actually read — a pricing page, a trust or
  // security-posture page, an imprint, an accessibility statement, a SECURITY file, a README
  // carrying Annex II information, a moderation policy.
  //
  // Added 2026-07-28 after adversarial verification measured what reaches them: **the content pass
  // scored 0 to 1 of the required 3 markers on every one of them**, so they were reachable by name
  // alone. Renaming `TrustPolicy` to `Governance`, or `Accessibility` to `A11y`, and the product
  // reported nothing. Worst case measured: the pricing page carrying all four of one case's items
  // was found *only* as a sibling of the terms page beside it, so deleting that neighbour made four
  // items' evidence invisible — which the fixture harness now demonstrates directly.
  //
  // Three or more entries per document kind, for the same reason the language blocks have three:
  // a page must clear the threshold on what it is about, without leaning on the structural entries.
  /\bper (month|user|seat|node|gigabyte|GB)\b/i, // pricing
  /\b(billed|charged) (monthly|annually|per)\b/i, // pricing
  /\b(early )?termination (penalt|fee|charge)/i, // pricing
  /\b(free tier|price list|pricing plan|subscription plan)\b/i, // pricing
  /\bdata (residency|location|region)\b/i, // trust page
  /\bgovernmental (access|requests?)\b/i, // trust page
  /\bjurisdiction (of|to which|applicable to)\b/i, // trust page
  /\bdata (access|disclosure) request\b/i, // trust page
  /\bimprint\b/i, // imprint, in the languages that use the English word
  /\b(technical|organisational|organizational) (and contractual )?measures\b/i, // trust page
  /\bnon-?personal data\b/i, // trust page
  /\bcoordinated vulnerability disclosure\b/i, // SECURITY
  /\bsecurity\.txt\b/i, // SECURITY
  /\breport a (security )?(vulnerability|issue)\b/i, // SECURITY
  /\bregistered (trade name|trademark|office)\b/i, // imprint
  /\bmanaging director|Gesch[äa]ftsf[üu]hrer\b/i, // imprint
  /\bcompany (registration|number)\b/i, // imprint
  /\bscreen reader\b/i, // accessibility statement
  /\bkeyboard (only |alone|navigation|operable)\b/i, // accessibility statement
  /\bcontrast ratio\b/i, // accessibility statement
  /\baccessible formats?\b/i, // accessibility statement
  /\bsoftware bill of materials|\bSBOM\b/i, // README carrying Annex II information
  /\bintended purpose\b/i, // README carrying Annex II information
  /\breasonably foreseeable (misuse|use)\b/i, // README carrying Annex II information
  /\b(appeal|appeals) (process|procedure)\b/i, // moderation policy
  /\bprohibited content\b/i, // moderation policy
  /\b(automated|algorithmic) (classifier|moderation|decision)/i, // moderation policy
  /\b(VAT|value added tax) identification number\b/i,
  /\bcommercial register\b/i,
  // The German imprint is a fixed statutory formula, which makes it the single most reliable
  // marker in this list for an EU operator page.
  /\bImpressum\b/,
  /Angaben gem[äa][sß]{1,2}\s*§\s*5\s*(TMG|DDG)/i,
  /Umsatzsteuer-?Identifikationsnummer|USt-IdNr/i,
  /Barrierefreiheitserkl[äa]rung/i,
  // The rest of the Union's official languages, added 2026-07-28 with the glob block above and for
  // the same measured reason. The globs are the fast path and will always be an incomplete
  // enumeration of names; these markers are the safety net, because they read what a page *says*.
  // **Three or more topic entries per language**, so a page clears the threshold of three in its
  // own language without leaning on the structural entries at the end of this list. Measured
  // 2026-07-28, second verification round: with two topic entries, 12 of 19 languages were found
  // only while the page happened to carry a "last updated" line and an "Article N" heading —
  // remove either and the page vanished. Irish and Maltese had one topic entry each and were
  // never found at all.
  /dane osobowe/i, // pl
  /(regulamin|warunki korzystania|polityka prywatno)/i, // pl
  /persoonsgegevens/i, // nl
  /(algemene voorwaarden|privacyverklaring|privacybeleid)/i, // nl
  /dados pessoais/i, // pt
  /(termos de (uso|servi)|pol[íi]tica de privacidade)/i, // pt
  /personuppgifter/i, // sv
  /((anv[äa]ndar|allm[äa]nna) villkor|integritetspolicy)/i, // sv
  /(persondata|personoplysninger)/i, // da
  /(handelsbetingelser|privatlivspolitik|vilk[åa]r for)/i, // da
  /henkil[öo]tiedot/i, // fi
  /(k[äa]ytt[öo]ehdot|tietosuoja(seloste|k[äa]yt[äa]nt[öo]))/i, // fi
  /osobn[íi] [úu]daje/i, // cs
  /(obchodn[íi] podm[íi]nky|z[áa]sady ochrany osobn[íi]ch [úu]daj)/i, // cs
  /osobn[ée] [úu]daje/i, // sk
  /obchodn[ée] podmienky/i, // sk
  /osebni podatki/i, // sl
  /pogoji uporabe/i, // sl
  /osobni podaci/i, // hr
  /uvjeti kori[šs]tenja/i, // hr
  /date (cu caracter )?personale?/i, // ro
  /(termeni [șs]i condi[țt]ii|politica de confiden[țt]ialitate)/i, // ro
  /szem[ée]lyes adatok/i, // hu
  /((felhaszn[áa]l[áa]si|szerz[őo]d[ée]si) felt[ée]telek|adatv[ée]delmi)/i, // hu
  /лични данни/i, // bg
  /(общи условия|политика за поверителност)/i, // bg
  /προσωπικά δεδομένα/i, // el
  /(όροι χρήσης|πολιτική απορρήτου)/i, // el
  /isikuandmed/i, // et
  /kasutustingimused/i, // et
  /personas dati/i, // lv
  /lieto[šs]anas noteikumi/i, // lv
  /asmens duomenys/i, // lt
  /naudojimo s[ąa]lygos/i, // lt
  /sonra[íi] pearsanta/i, // ga
  /dejta personali/i, // mt
  // Strengthening the three Romance languages that had one or two entries and could not reach the
  // threshold on their own.
  /(aviso legal|responsable del tratamiento|condiciones (generales )?de)/i, // es
  /(titolare del trattamento|condizioni (generali )?(di|d.)\s*(uso|utilizzo|servizio))/i, // it
  /(mentions l[ée]gales|responsable du traitement)/i, // fr
  // The term for the data controller, per language — the word a privacy notice cannot avoid and
  // ordinary source never contains. One concept per entry, one entry per language.
  /administrator danych/i, // pl
  /verwerkingsverantwoordelijke/i, // nl
  /personuppgiftsansvarig/i, // sv
  /dataansvarlig/i, // da
  /rekisterinpit[äa]j[äa]/i, // fi
  /spr[áa]vce (osobn[íi]ch )?[úu]daj[ůu]/i, // cs
  /prev[áa]dzkovate[ľl]/i, // sk
  /ochrana osobn[ýy]ch [úu]dajov/i, // sk — data protection
  /upravljavec/i, // sl
  /voditelj obrade/i, // hr
  /operator de date/i, // ro
  /adatkezel[őo]/i, // hu
  /администратор на лични данни/i, // bg
  /υπεύθυνος επεξεργασίας/i, // el
  /respons[áa]vel pelo tratamento/i, // pt
  // The five languages the second verification round showed were never found at all: Estonian,
  // Latvian, Lithuanian, Irish, Maltese. Each now has three or more topic entries of its own.
  /privaatsuspoliitika/i, // et — privacy policy
  /andmekaitse/i, // et — data protection
  /priv[āa]tuma politika/i, // lv — privacy policy
  /datu aizsardz[īi]ba/i, // lv — data protection
  /privatumo politika/i, // lt — privacy policy
  /duomen[ųu] apsauga/i, // lt — data protection
  /t[ée]arma[íi] [úu]s[áa]ide/i, // ga — terms of use
  /beartas pr[íi]obh[áa]ideachais/i, // ga — privacy policy
  /cosaint sonra[íi]/i, // ga — data protection
  /termini tal-u[żz]u/i, // mt — terms of use
  /politika tal-privatezza/i, // mt — privacy policy
  /protezzjoni tad-data/i, // mt — data protection
  // Structural, across languages: the date a legal document took effect, and its article
  // numbering. One concept per entry, so each is a single alternation over the same concept.
  // Unicode-aware boundaries, not `\b`: JavaScript's `\w` is ASCII, so `\b` never fires before a
  // Greek or Cyrillic letter and these two entries silently matched nothing in those alphabets.
  // Found by testing a Greek and a Bulgarian page, which scored 2 of the required 3 markers.
  /(?:^|\P{L})(derni[èe]re (mise [àa] jour|modification)|[úu]ltima actualizaci[óo]n|ultimo aggiornamento|[úu]ltima atualiza[çc][ãa]o|letzte Aktualisierung|ostatnia aktualizacja|senast uppdaterad|sidst opdateret|viimeksi p[äa]ivitetty|posledn[íi] aktualizace|zadnja posodobitev|ultima actualizare|utols[óo] friss[íi]t[ée]s|последна актуализация|τελευταία ενημέρωση|laatst bijgewerkt|viimati uuendatud|p[ēe]d[ēe]joreiz atjaunin[āa]ts|paskutin[įi] kart[ąa] atnaujinta|nuashonraithe|l-a[ħh][ħh]ar a[ġg][ġg]ornament|posledn[áa] aktualiz[áa]cia|posljednje a[žz]uriranje|zadnje a[žz]uriranje)/iu,
  /(?:^|\P{L})(Artikel|Art[íi]culo|Articolo|Artigo|Artyku[łl]|[ČC]l[áa]nek|[ČC]l[áa]nok|[ČC]len|Članak|Articolul|Cikk|Artikkel|Artikla|Pants|Straipsnis|Airteagal|Artikolu|Άρθρο|Член)\s*\d+/iu,
  // Latvian and Lithuanian put the numeral first — `1. pants`, `3 straipsnis` — so the entry above
  // can never match them in their own word order.
  /(?:^|\P{L})\d+\.?\s*(pants|panta|straipsnis|straipsnio)(?:\P{L}|$)/iu,
  // The section sign, which German, Estonian and Finnish legal pages number by instead of "Article".
  /§\s*\d+/u,
  /personenbezogene[rn]? Daten/i,
  /Datenschutz(erkl[äa]rung|hinweise|bestimmungen)/i,
  /Nutzungsbedingungen|Allgemeine Gesch[äa]ftsbedingungen/i,
  /donn[ée]es (à caract[èe]re )?personnelles/i,
  /politique de confidentialit[ée]/i,
  /conditions (g[ée]n[ée]rales )?d.utilisation/i,
  /datos personales|pol[íi]tica de privacidad/i,
  /dati personali|informativa sulla privacy/i,
];

/**
 * How many distinct markers make a file a candidate declaration.
 *
 * Three, which is low on purpose. A file that says "personal data", "third parties" and "retention
 * period" is a legal document or is quoting one, and either way the agent should see it. The cost
 * of being wrong here is one file the agent reads and dismisses; the cost of being wrong the other
 * way is the tool reporting that a repository has no privacy policy when it has one under a name
 * nobody guessed.
 */
const CONTENT_MARKER_THRESHOLD = 3;

/* ------------------------------------------------------------------------- *
 * The document-shape clause — a confirming path beside the threshold, added 2026-09-02.
 * ------------------------------------------------------------------------- *
 *
 * **The hole this closes.** The threshold above asks one question: *does this file contain three
 * legal phrases?* Every translation catalogue in a localised application answers yes. On the first
 * real-repository pillar-2 run, one tree's fourteen `.xlf` files, each several thousand lines long,
 * cleared it on four UI labels scattered through thousands of translated strings (`Privacy Policy`,
 * `Terms and Conditions`, `per User`, and one sentence containing `we share`) and were reported as
 * fourteen candidate declarations, each to be read in full by an agent. `documents_found: 20` said
 * twenty candidate declarations were found and read when six of them were.
 *
 * **The shape of the repair, and why it is not the obvious one.** The obvious repair is to exclude
 * `.xlf`, or to raise the threshold. Both are subtraction, and subtraction is the only operation
 * that can create a miss. This module's own pass-2.5 comment already names the case:
 * *"a policy kept in a `.txt`, a `.vue`, a `.php`, or — the case this project has built a fixture
 * for and has not yet met in the corpus — a
 * `.json` message catalogue"*. A rule whose target is a document but whose test matches a bare
 * phrase is **under-specified, not over-specified**, and the repair is a clause that recognises the
 * construct, beside the one already there.
 *
 * So a file is offered as a candidate declaration when it clears the threshold **and** is
 * document-shaped, where document-shaped has **three independent routes and any one is enough**:
 *
 *   1. **The file is mostly sentences** (`prose_char_ratio >= PROSE_CHAR_RATIO_FLOOR`). A legal
 *      document is prose; a record set is scaffolding with values in it.
 *   2. **Every marker sits beside sentences** (`markers_with_prose_nearby === markers_matched`).
 *      This is the route that reaches a policy embedded in a large source file, where the file as a
 *      whole is code and the passage is a document.
 *   3. **The file is short** (`<= SHORT_FILE_LINES`). Reading it costs an agent almost nothing, so
 *      screening it could only ever lose something.
 *
 * **Measured before it was chosen**, over the fourteen catalogues and five real documents (the two
 * one real tree's markdown declarations, this repository's own three fixture documents):
 *
 *   prose_char_ratio   catalogues 0.024 – 0.049      documents 0.455 – 0.930
 *   markers near prose  catalogues 2–3 of 4–6         documents all of them
 *
 * An order of magnitude of headroom on either side of the floor, on both routes independently.
 *
 * **Nothing is dropped.** A screened file is named in `looked_at.content_scan.screened[]` with its
 * markers and its measurements, so the reader sees that it was reached, what it said, and why it
 * was not offered — and `--policy <path>` puts any of them straight back into the run as an
 * explicitly supplied document. "We read this and it did not read like a document" is a statement
 * about the reading, and it is written down where a reader meets it.
 */

/** Below this share of prose characters a file is scaffolding with values in it, not a document. */
const PROSE_CHAR_RATIO_FLOOR = 0.15;

/** A line this long, holding this many words once tags are stripped, is a sentence and not a label. */
const PROSE_LINE_MIN_CHARS = 40;
const PROSE_LINE_MIN_WORDS = 8;

/** How far either side of a marker a sentence still counts as the marker's own neighbourhood. */
const PROSE_NEIGHBOURHOOD_LINES = 10;

/**
 * A file no longer than this, and no larger than this, is never screened: reading it costs almost
 * nothing.
 *
 * **The character bound was added 2026-09-02** (a hole one real run found) because the line bound
 * alone made the route's own stated reason untrue. Fourteen of one tree's locale catalogues are
 * MINIFIED — the whole file is one line of 43,000 to 57,000 characters — and they cleared a floor
 * whose justification is that reading the file is cheap, when reading one of them costs an agent
 * more than reading a real privacy policy and, as run 1 measured, cannot be paged into at all by a
 * line-indexed reader once it passes one read's token cap. This is a target-correctness repair, not
 * a narrowing: the route asserts cheapness and these files are not cheap. Both bounds are generous
 * against every real document measured — the largest declaration in either run's corpus that is
 * under 400 lines is 6,682 characters — and a file the two bounds now exclude is still screened
 * with its numbers into `content_scan.screened[]` and still recovered by `--policy <path>`.
 *
 * **Stated honestly, and this is the whole of what is known about it (L1 of the run-2
 * verification): SO FAR THIS BOUND HAS SCREENED NOTHING.** On one tree, none of the screened files
 * is 400 lines or fewer, so not one was screened by the character bound; on another all 14
 * screened files are 8,196 lines or longer. The fourteen minified catalogues it was written for are
 * each one line carrying three legal phrases, so `byPassage` keeps them whatever this route says —
 * the routes are independent and any one is enough, by design. What the bound fixes is the route's
 * own CLAIM, which was false and would have carried the next file of this shape on its own; it is a
 * subtraction taken on an argument rather than on a measurement, and it is recorded as such rather
 * than presented as a measured saving. The measured cost of those fourteen is 0.69 MB of the 3.71 MB
 * of catalogue text this repair leaves on the table.
 */
const SHORT_FILE_LINES = 400;
const SHORT_FILE_CHARS = 40_000;

/**
 * One matched marker and EVERY line it occurs on, 1-based (BLOCKING 2 of the 2026-09-02
 * verification). `line` used to be a single number — the marker's first occurrence — and a first
 * occurrence is systematically its least representative one: a nav label, a `<title>`, a
 * front-matter key. The neighbourhood route asks whether every marker sits beside a sentence, so
 * scoring a marker on its first occurrence let one ordinary footer label (`"nav.privacy": "Privacy
 * Policy"`) flip a real embedded policy from kept to screened. A marker is near prose if ANY of its
 * occurrences is, so the list is all of them.
 */
interface MarkerHit {
  text: string;
  lines: number[];
}

/** Occurrences collected per marker before the count stops mattering — bounds the per-file cost. */
const MARKER_OCCURRENCE_CAP = 200;

/** Every 1-based line `re` matches on in `text`, capped, with a global clone so the source regex is untouched. */
function markerLines(re: RegExp, text: string): number[] {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const lines: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null && lines.length < MARKER_OCCURRENCE_CAP) {
    lines.push(text.slice(0, m.index).split(/\r?\n/).length);
    if (m.index === g.lastIndex) g.lastIndex++; // a zero-width match would loop forever otherwise
  }
  return lines;
}

/**
 * Scripts that do not separate words with spaces: Han, the two Japanese kana, Hangul syllables,
 * Thai, Lao, Khmer, Myanmar. A sentence in any of these has no spaces to count, so the word test
 * below scores it zero however much it says.
 */
const SPACELESS_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;

/**
 * Whether one line is a sentence rather than a label, a key, a tag or a record separator.
 *
 * Markup tags are removed first, because the whole discriminator is about what a file SAYS rather
 * than how it is stored: `<source>Privacy Policy</source>` is a two-word label whichever way it is
 * spelled, and a sentence inside a `<p>` is a sentence.
 *
 * **Two ways to be prose, because two families of script write a sentence differently** (BLOCKING 1
 * of the 2026-09-02 verification). The word count is the test for a script that separates words with
 * spaces. A script that does not — Japanese, Chinese, Korean-in-Han, Thai, and the rest of
 * `SPACELESS_SCRIPT` — writes a whole sentence with no space in it, so `split(" ")` scored every
 * such line at one word and every such document at `prose_char_ratio 0`, screening a 480-line
 * Japanese privacy policy ("kojin joho hogo hoshin") while keeping the same text at 359 lines. **This is the worst miss this product can
 * make**: the Japanese pack is pillar 2's differentiator, `discover.ts` carries Japanese
 * content markers for exactly this document, and the content pass is the only route to a policy under
 * a name no glob reaches. So a dense run of space-less-script characters counts as prose too, on the
 * same character floor the word test clears — never a lower bar, only a second way over the same one.
 * Add-only: a line that was prose by the word count still is.
 */
function isProseLine(line: string): boolean {
  const stripped = line.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (stripped.length < PROSE_LINE_MIN_CHARS) return false;
  if (stripped.split(" ").filter(Boolean).length >= PROSE_LINE_MIN_WORDS) return true;
  // A run of space-less-script characters at least as long as half the prose-line character floor
  // is a sentence in a script that does not use spaces. Half, because two ASCII characters carry
  // roughly the information of one Han character, so a sentence's worth is fewer of them.
  const dense = stripped.match(SPACELESS_SCRIPT);
  return (dense?.length ?? 0) >= Math.ceil(PROSE_LINE_MIN_CHARS / 2);
}

/* ------------------------------------------------------------------------- *
 * The record-shape discount — the deferred residual of the 2026-09-02 repair, closed 2026-09-02.
 * ------------------------------------------------------------------------- *
 *
 * **The hole.** The shape clause above screens a catalogue whose values are LABELS and keeps one
 * whose values are SENTENCES, in any script — pre-existing for English, made symmetric for CJK by
 * the space-less-script fix. Run 1's adversarial verifier rated that residual safe and deferred it;
 * run 2 measured its cost on a heavily localised repository. On one tree, **98 of 165 discovered
 * documents are translation catalogues and they carry 17.35 MB of the 19.0 MB of extracted document
 * text — 91 % of every byte** a consumer of `documents[]` would read. Every one of the 98 was kept
 * by the RATIO route and by no other: their `msgstr` and `"key": "value"` lines are full sentences,
 * so they scored 0.19 to 0.99 where a label catalogue scores 0.03.
 *
 * That cost is not only tokens. Two real, consequential documents — one tree's own Terms and Privacy
 * Policy for its paid hosted tier, rendered as TypeScript route handlers — sat at lines 120 and 121
 * of a 169-line discovery listing that was 65 % near-identical catalogue rows, and the run's
 * orchestrator read the list in full and skimmed past both, then told six of seven subagents that no
 * terms-of-service document existed anywhere in the repository. A list that is mostly noise degrades
 * the one judgement downstream of it that has no mechanical check of its own.
 *
 * **The repair is the shape run 1's verifier proposed, and it is confined to ONE of the four
 * routes.** `prose_char_ratio` asks "is this file mostly sentences?", and its answer is wrong about
 * a catalogue for a reason that is visible in every line: the sentence is a VALUE inside a record,
 * and the file is a record set whatever the values say. So a line that is nothing but records —
 * `"legal.intro": "…"`, `msgstr "…"`, `<source>…</source>`, or a whole minified object of them —
 * does not count toward the numerator. The denominator is untouched, so a real document's ratio does
 * not move at all.
 *
 * **What this deliberately does NOT touch, and why the CJK regression cannot come back through it.**
 * `prose[]` itself is unchanged, so `byNeighbourhood` and `byPassage` see exactly the lines they saw
 * before. That is the whole safety of the design: a policy kept INSIDE a message catalogue — the case
 * `discover.ts` names as a constructed case rather than an observed one, and the case BLOCKING 2 of the run-1
 * verification was about — is kept by those two routes and is not kept by the ratio route (the gate
 * asserts precisely that, and would fail if it ever were). A Japanese privacy policy has no records in
 * it at all: a line opening "The Company, ..." is a sentence, not a key and a quoted value, so it is prose by the ratio route
 * exactly as before. Both are pinned as regressions.
 *
 * **Measured before it was chosen**, over one real tree:
 *
 *   ratio before -> after   `.po` catalogues     0.187–0.263 -> 0.000–0.001
 *                           locale JSON          0.466–0.484 -> 0.000
 *                           minified locale JSON 0.995–0.996 -> 0.000
 *                           real declarations    0.695–0.963 -> UNCHANGED, to three decimals
 *
 * Nothing is dropped: a file screened this way is named in `content_scan.screened[]` with its
 * markers and its numbers, and `--policy <path>` reads it in full as a supplied document.
 *
 * **WHAT THIS DOES NOT CLOSE, AND WHY IT WAS LEFT OPEN.** On that tree this takes the catalogues from
 * 98 documents and 17.35 MB to 35 documents and 3.71 MB. The 35 that remain are kept by `byPassage`,
 * not by the ratio: a catalogue whose keys are sorted alphabetically puts its privacy-related UI
 * strings next to each other, so three distinct markers really do cluster within ten lines of one
 * sentence. Every discriminator tried against that either fails to separate it from the
 * policy-in-a-catalogue fixture or breaks that fixture outright — a non-record anchor scores 0 on
 * BOTH; markers-carried-by-prose scores 5 on the fixture and 2 to 4 on the catalogues; prose lines
 * per window scores 3 on the fixture and 8 to 13 on the catalogues, in the wrong direction. Raising
 * the passage threshold from 3 to 5 would separate them **on this fixture**, which is tuning a
 * screen to one synthetic file and is exactly the narrowing this project forbids: subtraction is the only
 * operation that can create a miss, and the miss it would create is a real policy stored in a
 * catalogue, which this project has a fixture for and has not observed in the corpus. So the residual is CONTAINED rather than
 * screened — the console collapses near-identical clusters into one line each and prints the total
 * extracted bytes as a cost — and it is recorded here rather than quietly narrowed away.
 */

/** A quoted string, single or double, with escapes — the value half of a record. */
const QUOTED_VALUE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

/**
 * One catalogue element holding text, by the element names the catalogue FORMATS use.
 *
 * Named explicitly rather than matched as "any element with text in it", because the loose form
 * would call `<p>We collect personal data …</p>` a record and turn every HTML declaration into a
 * record set — the opposite of what this is for. XLIFF (`source`, `target`, `seg-source`), Qt
 * (`translation`), Android (`string`, `item`), .NET resx (`value`). None of these is an HTML prose
 * tag, and an RSS `<description>` or a DocBook `<para>` is deliberately not on the list.
 */
const CATALOGUE_ELEMENT = /<(source|target|seg-source|translation|string|value|item)\b[^>]*>[^<]*<\/\1>/gi;

/** The gettext record keywords, which introduce a quoted value with no separator between them. */
const PO_RECORD_KEYWORD = /(?:^|\s)(?:msgid_plural|msgctxt|msgid|msgstr)(?:\[\d+\])?(?=\s|$)/g;

/**
 * What may remain once every record on a line is removed: punctuation, brackets and digits. A word
 * left over means the line says something of its own and is not made of records.
 */
const ONLY_RECORD_SCAFFOLDING = /^[\s{}[\]()<>,;:=+\-.\d|/\\*#!?&%$@^~`'"]*$/;

/**
 * Whether a line is made of nothing but catalogue records.
 *
 * Requires at least one record to have been found, so a bare `<div>` or an empty line is not a
 * record line by default. `const message = "…a long sentence…";` is NOT one either: `const` and
 * `message` survive the strip, so a declaration embedded in source keeps its prose.
 */
function isRecordLine(line: string): boolean {
  let records = 0;
  const count = () => {
    records++;
    return " ";
  };
  const withoutElements = line.replace(CATALOGUE_ELEMENT, count);
  const withoutValues = withoutElements.replace(QUOTED_VALUE, count);
  if (records === 0) return false;
  return ONLY_RECORD_SCAFFOLDING.test(withoutValues.replace(PO_RECORD_KEYWORD, " "));
}

/**
 * The document-shape measurement, and the route that decided it.
 *
 * Pure and total: it never reads the filesystem, and every field it returns is derived from the
 * text and the marker positions it was given, so the gate can exercise the decision directly.
 */
export function measureContentShape(text: string, hits: MarkerHit[]): ContentShape {
  const lines = text.split(/\r?\n/);
  const prose: boolean[] = new Array(lines.length);
  let proseChars = 0;
  let totalChars = 0;
  let recordLines = 0;
  for (let i = 0; i < lines.length; i++) {
    totalChars += lines[i].length;
    const isProse = isProseLine(lines[i]);
    // `prose[]` is what the neighbourhood and passage routes read, and it is deliberately NOT
    // discounted: a sentence is a sentence wherever it sits, and a policy kept inside a catalogue is
    // kept by those two routes. Only the ratio's NUMERATOR discounts a record line — see the
    // record-shape discount above.
    prose[i] = isProse;
    if (!isProse) continue;
    if (isRecordLine(lines[i])) {
      recordLines++;
      continue;
    }
    proseChars += lines[i].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
  }
  const ratio = totalChars === 0 ? 0 : Math.round((proseChars / totalChars) * 1000) / 1000;

  // A marker counts as near prose if ANY of its occurrences is, not only its first (BLOCKING 2).
  let nearProse = 0;
  for (const hit of hits) {
    const near = hit.lines.some((line) => {
      const lo = Math.max(0, line - 1 - PROSE_NEIGHBOURHOOD_LINES);
      const hi = Math.min(lines.length - 1, line - 1 + PROSE_NEIGHBOURHOOD_LINES);
      for (let i = lo; i <= hi; i++) if (prose[i]) return true;
      return false;
    });
    if (near) nearProse++;
  }

  // A legal PASSAGE: some prose line with at least the candidate threshold of distinct markers
  // clustered around it. This is the route that keeps a policy embedded in a catalogue or a large
  // source file, and it is a fourth route ADDED beside the three below rather than a replacement, so
  // nothing kept before can be screened now (BLOCKING 2 of the 2026-09-02 verification). It exists
  // because `byNeighbourhood` demands EVERY marker sit near prose, and one ordinary footer label
  // (`"nav.privacy": "Privacy Policy"`) far from the policy body is enough to fail that — the
  // marker it adds occurs only in the label and nowhere in the prose, so best-occurrence scoring
  // cannot rescue it. A real embedded document is a CLUSTER of legal prose; a catalogue is markers
  // scattered thousands of lines apart, each near at most an isolated translated string, with no one
  // window holding a legal passage. Measured: one tree's fourteen `.xlf` files hold no such window
  // and still screen; the embedded-policy fixture with a stray footer label now clears this route.
  let byPassage = false;
  let passageMarkers = 0;
  for (let i = 0; i < lines.length && !byPassage; i++) {
    if (!prose[i]) continue;
    const lo = i - PROSE_NEIGHBOURHOOD_LINES;
    const hi = i + PROSE_NEIGHBOURHOOD_LINES;
    let here = 0;
    for (const hit of hits) {
      if (hit.lines.some((line) => line - 1 >= lo && line - 1 <= hi)) here++;
    }
    passageMarkers = Math.max(passageMarkers, here);
    if (here >= CONTENT_MARKER_THRESHOLD) byPassage = true;
  }

  const byRatio = ratio >= PROSE_CHAR_RATIO_FLOOR;
  const byNeighbourhood = hits.length > 0 && nearProse === hits.length;
  const byLength = lines.length <= SHORT_FILE_LINES && totalChars <= SHORT_FILE_CHARS;
  // The routes are reported most-informative first, so a file that satisfies several is described
  // by what it is rather than by the floor that would have saved it anyway. `byLength` is last
  // because it says nothing about the file except that screening it could only ever lose something.
  const reason = byRatio
    ? `${ratio} of its characters are sentences that are not a catalogue record's value, at or above the ${PROSE_CHAR_RATIO_FLOOR} floor, so the file is prose rather than a record set with values in it`
    : byPassage
      ? `${passageMarkers} matched phrase(s) cluster within ${PROSE_NEIGHBOURHOOD_LINES} lines of one prose passage, which is a legal passage embedded in a file that is not otherwise prose`
      : byNeighbourhood
        ? `all ${hits.length} matched phrase(s) sit within ${PROSE_NEIGHBOURHOOD_LINES} lines of a sentence, so the phrases are carried by prose even though the file as a whole is not`
        : byLength
          ? `at most ${SHORT_FILE_LINES} lines and ${SHORT_FILE_CHARS} characters, so it is never screened — reading it costs an agent almost nothing and screening it could only lose something`
          : `${lines.length} lines and ${totalChars} characters, ${ratio} of its characters are sentences that are not a catalogue record's value (floor ${PROSE_CHAR_RATIO_FLOOR}; ${recordLines} sentence-length line(s) in this file are a key and a quoted value and nothing else), the largest legal passage holds ${passageMarkers} of ${hits.length} matched phrase(s) (threshold ${CONTENT_MARKER_THRESHOLD}), and ${nearProse} of ${hits.length} sit near any sentence at all — the phrases are scattered through a record set rather than carried by a document. Not offered as a candidate declaration; pass --policy <path> to read it as one anyway`;

  return {
    lines: lines.length,
    prose_char_ratio: ratio,
    // Emitted so a reader can see WHY the ratio is what it is and dispute it: a catalogue whose
    // values are full sentences reports hundreds of record lines beside a ratio near zero, and a
    // real document reports none. Optional in the schema — absent means a document written before
    // the record-shape discount existed, which is not the same as a file measured and found to hold
    // no records.
    record_value_lines: recordLines,
    markers_with_prose_nearby: nearProse,
    markers_matched: hits.length,
    document_shaped: byLength || byRatio || byNeighbourhood || byPassage,
    reason,
  };
}

/**
 * Siblings are taken from the document's own directory level, not from an arbitrarily deep tree:
 * `X/page.tsx` contributes `Y/page.tsx`, and `docs/privacy.md` contributes `docs/*.md`. Two levels
 * is what the router shape needs and it stops `docs/privacy.md` from turning a whole manual into
 * declarations. Anything dropped by the limit is reported, never silently discarded.
 */
const SIBLING_MAX_DEPTH = 2;
const SIBLING_LIMIT = 60;

/* ------------------------------------------------------------------------- *
 * The sibling neighbourhood test — a confirming clause beside the root guard, added 2026-09-02.
 * ------------------------------------------------------------------------- *
 *
 * **The hole** (a hole one real run found). An accessibility page under a developer folder is a real, on-topic
 * candidate and the `**\/accessibility*` glob is right to find it. The sibling pass then read the
 * directory it happens to sit in — the tree's INTERNAL DEVELOPER DOCUMENTATION — as a
 * neighbourhood of legal documents and swept in **50 files**: `BUILD.md`, `coding_style.md`,
 * `DEPLOY.md`, and nineteen technical specifications under `readme/dev/spec/` (`sync_lock.md`,
 * `plugins.md`, `server_hardening.md` …), every one of them offered to a reconciler as a candidate
 * declaration on equal footing with the real privacy policy.
 *
 * The guard that already existed — `if (root === "") continue` — was built for exactly this failure
 * shape and only fires at the REPOSITORY ROOT. `readme/` in this repository is functionally a second
 * root: a whole documentation tree parked one level down, where the guard's depth-0-only condition
 * says nothing.
 *
 * **THE GATE APPLIES TO THE WHOLESALE SWEEP AND NEVER TO AN INDIVIDUALLY DECLARATION-SHAPED FILE.**
 * That distinction is the whole of the repair, and it was not true of the first attempt: the
 * neighbourhood test alone is a NEW GATE ON AN EXISTING PASS, which reduces the pass's reach, and
 * the run-2 verification demonstrated the cost — a genuine `docs/legal-pages/cookie-notice.md`
 * carrying fewer than the content pass's three markers, in a directory scoring 1 of 22, reached
 * `found[]` by no route at all. Measured on one tree: 287 neighbours declined and the content pass
 * rescued **0** of them, because a neighbour that fails the content pass's own bar is exactly the
 * population the sibling pass exists to reach. Citing "subtraction is the only operation that can
 * create a miss" in support of a subtraction was the wrong reading of it; the rule's actual
 * consequence is the clause below.
 *
 * So there are four ways in, and any one is enough:
 *
 *   - **A declaration neighbourhood expands whole, exactly as before.** At least
 *     `SIBLING_MIN_DECLARATION_NAMED` of the candidates under the root carry a declaration-shaped
 *     NAME, and they are at least `SIBLING_NEIGHBOURHOOD_SHARE` of them. This is the owner's own
 *     application: `app/(marketing)/(legal)/` holds `PrivacyPolicy/`, `TermsOfService/` and
 *     `CommunityRules/`, and the third is reached only this way.
 *   - **A router-role file is added from any root at all.** `page.tsx`, `index.tsx`, `route.ts` —
 *     the files whose identity is their directory and whose text is routinely in an imported
 *     component, so no content test can see it. This is the other case the pass exists for and it is
 *     kept unconditionally. (Verified at share 0.222: a nine-page `(legal)` router directory fails
 *     the share test and every one of its seven unnamed legal pages is still added, by this clause.)
 *   - **A neighbour whose own NAME is a declaration's name is added from any root at all.** Vacuous
 *     for a file the name passes already reach, and stated anyway so the gate can never be read as
 *     applying to one.
 *   - **A neighbour that is individually declaration-SHAPED is added from any root at all**:
 *     it carries at least `SIBLING_MARKER_THRESHOLD` legal phrase and `measureContentShape` says it
 *     reads like a document. **A stranger needs three markers because nothing vouches for it; a
 *     neighbour of a confirmed declaration has its LOCATION as corroboration, so one phrase plus the
 *     document shape is enough.** This is the confirming path added beside the loose one, and it is
 *     what rescues the cookie notice above.
 *
 * A neighbour that reaches none of the four carries no legal phrase at all, or does not read like a
 * document — and is still read by the CONTENT pass on its own merits, still NAMED with its reason in
 * `sibling_expansions[].not_added[]` alongside the numbers the decision was taken on, and still read
 * in full by `--policy <path>`.
 *
 * **Measured on the real trees before the constants were chosen** (share = declaration-named ÷
 * candidates within `SIBLING_MAX_DEPTH` of the root):
 *
 *   kotoba-mini  `src/app/(marketing)/(legal)`  2 named of 3   0.667  expands, as before
 *   tree A       `docs`                       5 named of 182 0.027  declined
 *   tree A       `docs/dev`                      1 named of 51  0.020  declined (the 50 dev docs)
 *   tree A       `docs/apps`                     1 named of 58  0.017  declined
 *   tree A       `docs/welcome`                 1 named of 6   0.167  declined on the count too
 *
 * And the marker threshold for the shape clause, measured over that tree's 287 declined neighbours:
 * **one marker rescues 17, two rescues 6, three rescues 0** (measured before the same
 * commit widened the third[- ]party marker; post-widening the one-marker figure is 19, and
 * readme/dev/ yields 6 individually-shaped additions, not 5). Three is the content pass's own bar and
 * rescues nothing by construction; two would miss a cookie notice carrying a single legal phrase,
 * which is the case this clause exists for. One is chosen, and the 17 it admits — release notes and
 * a contributor-licence page among them — are candidates a reconciler dismisses, which the project's
 * asymmetry rule prices as the cheap direction.
 */
const SIBLING_MIN_DECLARATION_NAMED = 2;
const SIBLING_NEIGHBOURHOOD_SHARE = 0.25;
const SIBLING_MARKER_THRESHOLD = 1;

export interface DiscoverOptions {
  /** Walked paths relative to the scan root. */
  files: string[];
  /** `--policy` arguments that are repository paths (already made relative to the scan root). */
  explicitPaths?: string[];
  /** `--policy` arguments that are URLs, already fetched by the caller. */
  urls?: string[];
  /** Reads a walked file. Returns null when the file cannot be read; the reason is reported. */
  readFile: (relPath: string) => string | null;
  /**
   * Applied to a referencing line, trimmed, BEFORE the cut to 300 characters: `reconcile` passes the
   * credential redaction, so a credential straddling the cut is redacted whole. None: the line as it is.
   */
  lineText?: (trimmedLine: string) => string;
  /**
   * Paths the walker refused **because it could not read them** — a binary extension, binary bytes,
   * or the size ceiling — with the reason, from `walkTarget`'s `refused` filtered by
   * `UNREADABLE_REASONS`. Optional; a caller that walks the tree itself passes nothing.
   *
   * **Why discovery is told about files it was not given** (owner's extension ruling, 2026-09-02).
   * Once every walked path is tested by name, the only files whose names say "declaration" and which
   * discovery never sees at all are the ones refused before the walk handed anything over — and the
   * commonest legal document on the internet that this tool cannot read is a `privacy.pdf`. The
   * aggregated `excluded_by_walker` does report them, capped at three examples per directory, which
   * means a real one can be in the count and not in the list. Named here instead, in the same
   * `content_scan.screened[]` a name-matched binary lands in when discovery meets it directly: one
   * list for "reached and not offered", whichever layer did the reaching.
   */
  refusedByWalker?: { path: string; reason: string; shown?: string }[];
}

function extensionOf(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function dirOf(path: string): string {
  const p = path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function baseOf(path: string): string {
  const p = path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function stemOf(path: string): string {
  const base = baseOf(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * The neighbourhood a document's siblings live in.
 *
 * For a router file (`…/PrivacyPolicy/page.tsx`) the document's identity is its directory, so the
 * neighbourhood is that directory's parent — which is where the other legal pages sit. For an
 * ordinary file (`docs/privacy.md`) the neighbourhood is its own directory.
 */
function siblingRoot(path: string): string {
  const dir = dirOf(path);
  if (ROLE_BASENAMES.has(stemOf(path).toLowerCase())) return dirOf(dir);
  return dir;
}

/**
 * Keys that identify a document to any file that links to or records it.
 *
 * For `web/src/app/(blank-pages)/(service)/PrivacyPolicy/page.tsx` these are the route
 * `/PrivacyPolicy` and the directory name `PrivacyPolicy`. Parenthesised segments are Next.js
 * route groups and never appear in a URL, so they are dropped when building the route.
 */
function referenceKeys(path: string): string[] {
  const p = path.replace(/\\/g, "/");
  const segments = p.split("/");
  const isRole = ROLE_BASENAMES.has(stemOf(p).toLowerCase());
  const nameSegments = isRole ? segments.slice(0, -1) : [...segments.slice(0, -1), stemOf(p)];

  const keys = new Set<string>();

  const last = nameSegments[nameSegments.length - 1];
  if (last) keys.add(last);

  // The route as a browser would see it: everything after `app/` or `pages/`, minus route groups.
  const anchor = nameSegments.findIndex((s) => s === "app" || s === "pages");
  if (anchor >= 0) {
    const route = nameSegments
      .slice(anchor + 1)
      .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
      .join("/");
    if (route) keys.add(`/${route}`);
  }

  return [...keys].filter((k) => {
    const bare = k.replace(/^\//, "");
    return bare.length >= MIN_KEY_LENGTH && !KEY_STOPLIST.has(bare.toLowerCase());
  });
}

/**
 * The paths a glob is tested against.
 *
 * The four glob patterns are written the way anyone would write them — `**\/privacy*` — and they
 * match a *file* called `privacy…`. In an app router the file is called `page.tsx` and the document
 * is named by its directory, so `…/PrivacyPolicy/page.tsx` matches none of the four. Measured
 * against the owner's application, that is not a corner case: it is **all eight documents**, and
 * discovery found one file, a README.
 *
 * So a router file is also tested under its directory's path. This is the same reading of the same
 * convention that `siblingRoot` already uses: the directory is the document's name, the basename is
 * its role.
 */
function identityPaths(path: string): string[] {
  const lower = path.toLowerCase();
  if (!ROLE_BASENAMES.has(stemOf(path).toLowerCase())) return [lower];
  const dir = dirOf(lower);
  return dir ? [lower, dir] : [lower];
}

/**
 * What a file SAYS and what it reads LIKE, measured once.
 *
 * Extracted 2026-09-02 (M2 of the run-2 verification) because two passes now ask it — the content
 * pass, which asks it of a stranger, and the sibling pass, which asks it of a neighbour. One
 * implementation, so the two can never come to hold different ideas of "reads like a document";
 * `markers` keeps each marker's FIRST occurrence text, as the reported list has always done, while
 * `hits` carries every occurrence for the shape clause's best-occurrence scoring.
 */
function readMarkersAndShape(text: string): { markers: string[]; shape: ContentShape } {
  const markers: string[] = [];
  const hits: MarkerHit[] = [];
  for (const re of CONTENT_MARKERS) {
    const hit = re.exec(text);
    if (hit) {
      markers.push(hit[0].toLowerCase());
      hits.push({ text: hit[0], lines: markerLines(re, text) });
    }
    if (markers.length >= CONTENT_MARKER_THRESHOLD + 3) break;
  }
  return { markers, shape: measureContentShape(text, hits) };
}

/** Depth of `path` below `root`, in path segments. `root` itself is 0. */
function depthBelow(root: string, path: string): number {
  if (root === "") return path.split("/").length;
  if (!path.startsWith(`${root}/`)) return Infinity;
  return path.slice(root.length + 1).split("/").length;
}

/** Every declaration glob, compiled once per process rather than once per call. */
let compiledGlobs: { glob: string; re: CompiledGlobs }[] | null = null;
function declarationGlobs(): { glob: string; re: CompiledGlobs }[] {
  compiledGlobs ??= DECLARATION_GLOBS.map((g) => ({ glob: g, re: compileGlobs([g])! }));
  return compiledGlobs;
}

/**
 * A cheap NECESSARY condition for any declaration glob to match, **derived from the glob list rather
 * than written beside it.**
 *
 * Testing the 133 compiled globs against one path costs about 33 µs — nothing per candidate, and
 * minutes over the paths a large `node_modules` sweep enumerates. Since 2026-09-02 `reconcile.ts`
 * asks this question of every path the walker refuses, sweeps included, which is where that number
 * stops being theoretical. Every glob in the list contains at least one MANDATORY literal run of four
 * or more characters (`privacy`, `legal`, `readme`, `well-known`, `lietosanas-noteikumi`); a path
 * matching a glob therefore contains that glob's run, so a path containing none of the runs can match
 * no glob.
 *
 * **What is measured, and what is not** (F4 of the 2026-09-03 verification, correcting this comment's
 * first version). The figure below is a MICRO-BENCHMARK of this function and nothing else: 200,000
 * paths that match no glob take **6.55 s** without the prefilter and **0.050 s** with it, answers
 * identical on every path. **End-to-end runtime on the two corpus repositories is unchanged** —
 * one tree's median is 19.9 s on the parent build and 17.4 s here, and disabling the prefilter on this
 * build gives 17.8 s, inside run-to-run noise. Neither pinned clone carries `node_modules`, so the
 * sweep this is written for does not happen in those runs at all. The first version of this comment
 * also carried a "44 s → 17 s" end-to-end claim taken from two single runs of different builds; no
 * 44-second configuration reproduces, and the claim is withdrawn.
 *
 * **Fail-open by construction, and brace-aware since the same verification.** Only a literal run
 * OUTSIDE every brace group is mandatory: `**\/{tos,terms-of-service}*` requires neither alternative,
 * so deriving `terms-of-service` from it would build a condition that fails CLOSED and silently. So
 * brace groups are removed before the split, and a glob left with no run of four characters — nobody
 * has written one, and `**\/*.pdf` or that `{tos,…}` form would be one — sets this to null and the
 * prefilter disappears, leaving the full test to answer. The failure direction of a mistake here is
 * therefore slowness, never a miss. `test-reconcile.mjs` pins both halves: that every glob still
 * contributes a mandatory literal, and that ONE INSTANTIATED PATH PER GLOB — all 133, generated from
 * each glob's own syntax — still reaches its glob through this filter.
 */
const GLOB_LITERAL_PREFILTER: RegExp | null = (() => {
  const runs = new Set<string>();
  for (const glob of DECLARATION_GLOBS) {
    // A brace group is an alternation, so nothing inside one is required by the glob. Replaced with a
    // comma — a character the split below already treats as syntax — rather than deleted, so the text
    // either side of the group cannot fuse into a literal run that the glob does not require.
    const outsideBraces = glob.toLowerCase().replace(/\{[^{}]*\}/g, ",");
    // Everything else a glob's syntax can hold is removed too; what is left is literal text it
    // requires wherever it appears.
    const literals = outsideBraces.split(/[*?{}[\],/]+/).filter((s) => s.length >= 4);
    if (literals.length === 0) return null;
    for (const l of literals) runs.add(l);
  }
  const escaped = [...runs].map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("|"), "u");
})();

/**
 * The declaration glob this path's own NAME matches, or null. **A statement about the name and
 * nothing else** — it reads no bytes, and it says nothing about what the file is.
 *
 * Exported so the caller can ask the same question of paths discovery never receives: `reconcile.ts`
 * uses it to tell the walker which refused files are worth reporting individually, which is how a
 * `privacy.pdf` the walker could not open gets a line of its own rather than a slot in a capped
 * summary. One implementation, asked by both, because two copies of "is this a declaration's name"
 * would answer differently the first time a glob moved.
 */
export function nameShapeGlobFor(path: string): string | null {
  const normalised = path.replace(/\\/g, "/");
  // The prefilter is a necessary condition, not a decision: a path it rejects can match no glob.
  if (GLOB_LITERAL_PREFILTER && !GLOB_LITERAL_PREFILTER.test(normalised.toLowerCase())) return null;
  const identities = identityPaths(normalised);
  for (const { glob, re } of declarationGlobs()) {
    if (identities.some((p) => globsAllow(re, p))) return glob;
  }
  return null;
}

/**
 * The store-metadata field names whose file holds a URL and nothing else.
 *
 * Apple's App Store Connect metadata and `fastlane deliver`'s directory layout both write one file
 * per field, and these three carry a URL. Named exactly, because the alternative — a contains-style
 * `*url*` — matches ordinary source in every repository.
 */
const URL_POINTER_CONVENTIONS = new Set(["privacy_url", "support_url", "marketing_url"]);

/**
 * Longest a file may be and still be read as a POINTER rather than as a document.
 *
 * A pointer is one line. This bound exists so the test costs nothing on a large file and so a
 * document that happens to open with a URL can never be mistaken for one.
 */
const URL_POINTER_MAX_CHARS = 2000;

/**
 * Whether a discovered document is a store-metadata pointer: its entire content is one URL.
 *
 * **A statement about the content, confirmed against the name and never decided by it.** The test is
 * that the whole file, trimmed, is a single `http(s)` URL with no other text — which is what
 * `fastlane/metadata_bwpm_prod/default/privacy_url.txt` is (30 characters,
 * `https://bitwarden.com/privacy/`). The name then says which store field it is, and a file that is
 * a bare URL under some other name is still reported, as `bare-url-file`, because the content is the
 * fact and the convention is the label.
 *
 * **This classifies; it does not filter.** Every such file is still a discovered document, still
 * extracted and still listed. See `DiscoveredDoc.url_pointer` for what the classification is for.
 */
function readUrlPointer(
  path: string,
  readFile: (p: string) => string | null,
): { url: string; convention: string } | undefined {
  const text = readFile(path);
  if (text === null || text.length > URL_POINTER_MAX_CHARS) return undefined;
  const trimmed = text.trim();
  if (!/^https?:\/\/\S+$/.test(trimmed)) return undefined;
  const base = (path.replace(/\\/g, "/").split("/").pop() ?? "").toLowerCase();
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  /* **The convention is read from the stem's LAST separator-delimited segment**, because the glob
   * that reaches this file is separator-insensitive and this test was not (independent verification,
   * 2026-09-03, LOW 9). `**\/*{-,_,.}support_url*` reaches `2.support_url.txt` — an ordinal-prefixed
   * store-metadata file, the same shape a real run's store privacy page had — and the whole-stem test
   * then labelled it `bare-url-file`, so a file the glob was widened to find arrived without the
   * label the widening was for. `support_url` and `marketing_url` carry an underscore of their own,
   * so the split keeps the last TWO segments as well as the last one and tries both, longest first. */
  const segments = stem.split(/[-_.]/).filter(Boolean);
  const tails = [
    stem,
    segments.slice(-2).join("_"),
    segments.slice(-1).join("_"),
  ];
  const convention = tails.find((t) => URL_POINTER_CONVENTIONS.has(t));
  return {
    url: trimmed,
    convention: convention ?? "bare-url-file",
  };
}

export function discoverDocuments(opts: DiscoverOptions): DiscoveryResult {
  const files = opts.files.map((f) => f.replace(/\\/g, "/"));
  // Reported, never consulted: the format mix of the tree, as a cost label. See DOCUMENT_FORMAT_EXTS.
  const formatExts = new Set(DOCUMENT_FORMAT_EXTS);
  const documentFormatFiles = files.filter((f) => formatExts.has(extensionOf(f))).length;

  const found = new Map<string, DiscoveredDoc>();

  /**
   * Files reached and not offered as candidate declarations, each with the reason. Declared here,
   * above pass 1, because two different passes now put a file in it: the NAME pass, when a file
   * whose name is a declaration's name turns out not to be text at all, and the CONTENT pass, when a
   * file that says what a legal document says does not read like one.
   */
  const content_screened: ContentMatch[] = [];
  /**
   * The same files as a set. Pass 3 reads it to mark a reference that comes out of a screened file,
   * and pass 1 and pass 2.5 both write to it.
   */
  const screened = new Set<string>();

  /**
   * The ONE test in this module that turns a file away for what it IS rather than for what it says.
   *
   * **A readability filter, not a judgement** (see
   * `DOCUMENT_FORMAT_EXTS`). It asks whether the bytes are text, which is a fact about the file and
   * not an opinion about its contents: a PNG called `privacy.png` cannot be quoted back to a user as
   * their published privacy policy however good its name is, and extracting it produces a page of
   * mojibake with a line number attached. The rule is the walker's own NUL test, imported rather than
   * restated (`walk.ts`'s `decodedTextIsBinary`), so the two can never come to disagree.
   *
   * **Nothing is dropped by it.** A file screened here is named in `content_scan.screened[]` with the
   * reason, exactly as a shape-screened file is, and `--policy <path>` still reads it as a supplied
   * document. In the shipped pipeline the walker has already refused such a file long before this
   * point; this exists because `discoverDocuments` is also called directly, with a file list nobody
   * sniffed, and because a name match must never be able to put unreadable bytes into `documents[]`.
   */
  const notText = new Set<string>();
  const screenIfNotText = (file: string, markers: string[]): boolean => {
    if (notText.has(file)) return true; // reached twice, recorded once
    const text = opts.readFile(file);
    // Unreadable is not the same as binary: keep it, and let the caller report why extraction failed.
    if (text === null || !decodedTextIsBinary(text)) return false;
    notText.add(file);
    screened.add(file);
    content_screened.push({
      file,
      markers,
      screened_label: "not text",
      screened_reason:
        "its bytes are not text — a NUL byte inside the first 4096 characters, which is the same test the walker applies. " +
        "This is a statement about the encoding and NOT about what the file is: the name still matches a declaration glob, and " +
        "--policy <path> reads it as a supplied document anyway",
    });
    return true;
  };

  /**
   * The declaration glob this path's own NAME matches, or null — `nameShapeGlobFor`, under the name
   * every pass below already calls it by.
   *
   * Asked of every path and independently of how the document was reached, because both restrictions
   * cost this project a real document. One tree's own Terms and Privacy Policy for its paid hosted tier
   * are `routes/index/terms.ts` and `routes/index/privacy.ts` — names that match `**\/terms*` and
   * `**\/privacy*` exactly — and pass 1 never tested them, because `ts` was not one of the extensions
   * that pass would consider. They were found by the content pass, arrived carrying no name signal at
   * all, and were read past in a 165-line listing. Since 2026-09-02 the
   * extension restriction is gone from pass 1 as well, so those two are now found BY NAME and this
   * function and pass 1 ask the same question of the same set of paths.
   *
   * `name_shape_glob` remains the field that lets a consumer sort a listing by "how likely is this
   * the document that decides the run" for documents reached by a pass other than the name pass (an
   * explicitly supplied `--policy` path, a sibling, a content match); `matched_glob` — which says a
   * document was found BY that glob — keeps its own, narrower meaning.
   */
  const nameShapeGlobOf = nameShapeGlobFor;

  // Pass 0 — what the user named explicitly. Recorded first so an explicit path is never
  // relabelled as an incidental glob hit.
  for (const p of opts.explicitPaths ?? []) {
    const rel = p.replace(/\\/g, "/");
    found.set(rel, { path: rel, kind: "file", found_by: "explicit" });
  }
  for (const u of opts.urls ?? []) {
    found.set(u, { path: u, kind: "url", found_by: "url" });
  }

  // Pass 1 — globs, matched against the lowercased path so `PrivacyPolicy/` is not missed by a
  // pattern written in lower case, over **every walked file** and not only the ones carrying a
  // document extension (see DOCUMENT_FORMAT_EXTS for what it cost).
  //
  // A file whose name is a declaration's name is a candidate whatever it is called after the last
  // dot, and never by the extension.
  //
  // **What actually runs on it afterwards, named accurately** (F8 of the 2026-09-03 verification,
  // correcting this comment's first version, which claimed `measureContentShape` did). It does not:
  // pass 1 asks only `screenIfNotText`, and pass 2.5 skips anything already in `found`, so no shape is
  // ever measured for a file the name pass took. What a name candidate does meet is the NUL screen
  // below, extraction (`extract.ts`, whose masker falls back to keeping the file whole), the
  // thin / one-line / `notes[]` warnings `reconcile.ts` prints over the extracted text, and layer 2 —
  // which is where a candidate is judged. This is visible in a real run: one tree's
  // `logo-privacy-tools.svg` reaches `documents[]` with 8,867 characters of path data and no shape
  // measurement anywhere, and it is the reader who dismisses it.
  for (const file of files) {
    if (found.has(file)) continue;
    const matched = nameShapeGlobOf(file);
    if (!matched) continue;
    // The one remaining turn-away, and it is about bytes: `privacy.png` matches `**/privacy*` and is
    // not text. Screened WITH ITS REASON rather than dropped, so a name that matched is never silent.
    if (screenIfNotText(file, [])) continue;
    found.set(file, { path: file, kind: "file", found_by: "glob", matched_glob: matched });
  }

  // Pass 2 — siblings of what the globs found. This is the pass that reaches the four documents
  // of the owner's application whose names match no policy-shaped pattern.
  const sibling_expansions: SiblingExpansion[] = [];
  /**
   * The seeds are every FILE document whose own name matches a declaration glob, not only the ones
   * `found_by: "glob"`.
   *
   * Filtering on `found_by` meant that supplying a document with `--policy` made discovery find
   * LESS: pass 0 records the file as `explicit`, so it stopped being a glob hit, so its own
   * directory stopped being a neighbourhood, and the sibling pass never ran there. On one tree the run
   * passed `--policy readme/privacy.md` and that alone removed the whole `readme/` expansion — 60
   * documents, `readme/welcome/5_privacy.md` among them. **A person answering the tool's own
   * question must never narrow the search**, which is the same asymmetry the rest of this module is
   * written against.
   */
  const seeds = [...found.values()].filter(
    (d) => d.kind === "file" && (d.found_by === "glob" || nameShapeGlobOf(d.path) !== null),
  );
  const rootsDone = new Set<string>();
  for (const hit of seeds) {
    const root = siblingRoot(hit.path);
    // The repository root is not a neighbourhood of legal pages, it is the whole project. Expanding
    // siblings from a root-level hit means "every top-level markdown file is a declaration", which
    // measured as +20 documents per repository the moment `readme*` was added — CONTRIBUTING,
    // CHANGELOG, CODE_OF_CONDUCT and the rest, none of which answers anything. The sibling pass
    // exists for router directories, where the neighbours of one legal page are the other legal
    // pages; at the root that reasoning does not hold.
    if (root === "") continue;
    if (rootsDone.has(root)) continue;
    rootsDone.add(root);

    // The neighbourhood test — see the constants above for what it is for and what it measured.
    // Counted over every file under the root INCLUDING the ones already found, because the
    // question is what kind of directory this is, not what is left in it.
    //
    // **Every walked file, not the document-extension ones**.
    //
    // **This is the one place in that repair where widening the candidate pool makes a test HARDER
    // to pass, and it was measured rather than assumed.** The share's denominator grows in a mixed
    // directory, so a `legal/` folder holding three markdown pages beside ten JSON files now scores
    // 3/13 where it scored 3/3. Measured on the two real trees: one tree's four documentation roots decline
    // before and after (5 of 182 -> 5 of 188, and so on), kotoba's `(legal)` confirms before and
    // after at 2 of 3, and **one root did flip — the other tree's assets folder, from 2 named
    // of 2 to 4 named of 24.** It cost that run nothing: the flip removed a wholesale sweep that had
    // added 0 documents, and the per-file routes below then admitted `robots.txt` on its own merits,
    // so the tree gained a document rather than losing one. The 19 neighbours the flip declined are
    // named in `not_added` and are 17 SVG logos, `fonts/inter.css` and `oss-friends.json` (F5 of the
    // 2026-09-03 verification, which counted the list this comment first described as 18 SVGs).
    //
    // The flip is also the test answering correctly rather than failing: `assets/` is not a
    // neighbourhood of legal pages, and it only looked like one while the denominator counted
    // markdown alone. What is NOT done here is keeping a second, extension-filtered denominator as a
    // fallback confirming path — that is exactly the extension judgement the ruling removes, and it
    // would decide an expansion. The residual exposure, recorded rather than argued away: a genuine
    // declaration carrying ZERO legal phrases, in a diluted directory, is no longer swept in. A file
    // carrying one phrase still is (`SIBLING_MARKER_THRESHOLD`), and a router-role file still is
    // unconditionally.
    const underRoot = files.filter((f) => depthBelow(root, f) <= SIBLING_MAX_DEPTH);
    const declarationNamed = underRoot.filter((f) => nameShapeGlobOf(f) !== null);
    const share = underRoot.length === 0 ? 0 : declarationNamed.length / underRoot.length;
    const neighbourhoodConfirmed =
      declarationNamed.length >= SIBLING_MIN_DECLARATION_NAMED && share >= SIBLING_NEIGHBOURHOOD_SHARE;

    const neighbours = underRoot.filter((f) => !found.has(f));
    const not_added: { file: string; reason: SiblingNotAddedReason }[] = [];
    let added = 0;
    for (const f of neighbours) {
      if (added >= SIBLING_LIMIT) {
        not_added.push({ file: f, reason: "over-the-per-directory-limit" });
        continue;
      }
      // A router-role file is added from any root: its identity is its directory and its text is
      // routinely in an imported component, so no content test downstream can see it.
      const roleFile = ROLE_BASENAMES.has(stemOf(f).toLowerCase());
      // A neighbour whose own NAME is a declaration's name is added from any root. Vacuous while
      // this loop draws from the walked files, since pass 1 has already taken every such file — and
      // since 2026-09-02 pass 1 tests all of them, so it is vacuous for every extension rather than
      // for six. Stated so the gate can never be read as applying to such a file.
      const namedFile = nameShapeGlobOf(f) !== null;
      // THE CONFIRMING PATH BESIDE THE GATE (M2 of the run-2 verification). A neighbour that is
      // individually declaration-shaped is added whatever its directory looks like: a legal phrase
      // plus the document shape, where a stranger in the content pass needs three phrases, because
      // sitting beside a confirmed declaration is itself corroboration. Read once and cached by the
      // caller, so this costs no read the content pass was not going to make anyway.
      let shaped = false;
      if (!neighbourhoodConfirmed && !roleFile && !namedFile) {
        const text = opts.readFile(f);
        if (text !== null) {
          const { markers, shape } = readMarkersAndShape(text);
          shaped = markers.length >= SIBLING_MARKER_THRESHOLD && shape.document_shaped;
        }
      }
      if (!neighbourhoodConfirmed && !roleFile && !namedFile && !shaped) {
        not_added.push({ file: f, reason: "not-a-declaration-neighbourhood" });
        continue;
      }
      // The same readability screen the name pass applies, at the other place a file can enter
      // `found` without the content pass having read it. A neighbour whose bytes are not text is
      // named in `content_scan.screened[]` with the reason rather than counted as not-added: one
      // list for "reached and not offered", one reason vocabulary, one helper.
      if (screenIfNotText(f, [])) continue;
      found.set(f, { path: f, kind: "file", found_by: "sibling", sibling_of: hit.path });
      added++;
    }
    sibling_expansions.push({
      root,
      from: hit.path,
      added,
      dropped_over_limit: not_added.filter((n) => n.reason === "over-the-per-directory-limit").length,
      candidates_under_root: underRoot.length,
      declaration_named_under_root: declarationNamed.length,
      neighbourhood_confirmed: neighbourhoodConfirmed,
      // Named, never counted alone. A neighbour this pass declined is still read by the content pass
      // below — which reads every walked file whatever it is called — and `--policy <path>` reads any
      // of them in full as a supplied document.
      not_added,
    });
  }

  // Pass 2.5 — content, over **every walked file**, not only the ones with a document extension.
  //
  // An extension is a name. Restricting this pass to `md/mdx/html/tsx` would have rebuilt the
  // defect it exists to remove, one level down: a policy kept in a `.txt`, a `.vue`, a `.php`, or —
  // the case this project has built a fixture for — a `.json` message catalogue, would be unreadable
  // because of what it is called. This repository has been here before. The walker used to skip
  // any path containing a segment named `test`, and the largest thing it hid was
  // `script/import_scripts/socialcast/test/`, which is an operational data-migration tool, while
  // `docs/spec/` is a specification and not a spec file. **A name does not tell you what a thing
  // is**, and a rule that decides from one fails silently on exactly the cases nobody predicted.
  //
  // The cost is bounded: the walker has already capped file size and skipped generated trees, and
  // the caller's read cache is shared with the census, so the bytes are read once per scan.
  const content_matches: ContentMatch[] = [];
  let filesReadForContent = 0;
  for (const file of files) {
    if (found.has(file)) continue;
    if (notText.has(file)) continue; // already reached, already screened, already named with its reason
    const text = opts.readFile(file);
    if (text === null) continue;
    filesReadForContent++;
    // Every line each marker matched on is carried into the shape clause: whether a phrase sits
    // beside a sentence is asked of the phrase's BEST occurrence, not its first (BLOCKING 2).
    // `markers[]` still records the first occurrence's text so the reported marker list does not
    // move. One implementation, shared with the sibling pass — see `readMarkersAndShape`.
    const { markers: matched, shape } = readMarkersAndShape(text);
    if (matched.length < CONTENT_MARKER_THRESHOLD) continue;
    // Asked only of a file that would otherwise be OFFERED. Asking it of every walked file would put
    // every image in a repository into `screened[]`, which is noise; asking it here means nothing
    // that was about to become a candidate declaration can be dropped without a reason beside it.
    if (screenIfNotText(file, matched)) continue;
    if (!shape.document_shaped) {
      screened.add(file);
      content_screened.push({ file, markers: matched, shape });
      continue;
    }
    found.set(file, { path: file, kind: "file", found_by: "content", markers: matched });
    content_matches.push({ file, markers: matched, shape });
  }

  // Pass 3 — files that reference a document without being one.
  const keyToDoc = new Map<string, string>();
  for (const doc of found.values()) {
    if (doc.kind !== "file") continue;
    for (const key of referenceKeys(doc.path)) {
      if (!keyToDoc.has(key)) keyToDoc.set(key, doc.path);
    }
  }
  const keys = [...keyToDoc.keys()];
  const referencing_files: ReferencingFile[] = [];
  const unreadable: { file: string; error: string }[] = [];

  if (keys.length > 0) {
    for (const file of files) {
      // A screened file is NOT skipped here (MODERATE 1 of the 2026-09-02 verification). It was,
      // and on the very repository shape this module names — a policy kept in a message catalogue —
      // that silenced the file twice: once out of `found` and once out of `referencing_files`. The
      // 120 rows it withheld on one tree were the translated "Privacy Policy" / "Terms of Service"
      // link labels across all fourteen catalogues, which is the population pass 3 exists to
      // surface — a screened file pointing AT a real document is a genuine reference. The rows are
      // marked `from_screened_file` instead, so a consumer can weigh them without them disappearing.
      //
      // **Neither is a DISCOVERED DOCUMENT skipped, from 2026-09-02, and this is the same defect one
      // more level up.** The rule is "a document is not a reference to itself", and it was
      // implemented as "a document is not a reference", which is a different and larger claim: a file
      // that is itself a declaration and ALSO points at another one — `terms-of-service-page.ts`
      // naming the markdown asset it renders, a version log inside `legal/` naming the policy whose
      // changes it records — carries a genuine reference, and it disappeared the moment the file
      // qualified as a document. Making the name passes extension-agnostic turned that from a rare
      // shape into a common one.
      //
      // **Measured on one tree, both numbers, because they answer different questions** (F5 of the
      // 2026-09-03 verification, correcting this comment's first version, which reported the first
      // number and described it as the second): the run's reference list gains **+17 rows net**, of
      // which 4 come out of newly-qualifying documents and 13 out of ordinary source that the larger
      // key set now reaches; and **21 rows** in the current run come out of a discovered document —
      // that is the population the old rule would have silenced. Neither number is "17 rows silenced".
      //
      // So only the SELF row is dropped, at the point where the key is matched, and a row that comes
      // out of a document is marked `from_discovered_document` rather than withheld.
      const content = opts.readFile(file);
      if (content === null) {
        unreadable.push({ file, error: "unreadable" });
        continue;
      }
      /**
       * The keys this file OWNS, when the file is itself a document. **The one test that keeps a
       * document from being recorded as a reference to itself**, and it replaced a narrower one on
       * 2026-09-03.
       *
       * The narrower test was `keyToDoc.get(key) === file` — "the key points back at me". It is
       * correct as far as it goes and it misses the case F6 of that day's verification demonstrated:
       * `keyToDoc` maps each key to the FIRST document that claimed it, so two documents with the same
       * stem share one key. `en/privacy-notice.md` and `de/privacy-notice.md` both produce
       * `privacy-notice`, owned by the English one, and the German file naming its own route produced
       * a row saying it points at the English document — a file recorded as referring to a document
       * when it is naming itself. The old test cannot see it, because the key maps elsewhere. A
       * multilingual document set with identical stems is exactly the population the EU-language globs
       * were added for; the exposure measured on the two real repositories is zero rows today.
       *
       * Asking "is this one of MY keys" answers both cases at once, so it is the only check here — the
       * old one was a strict special case of it (a key that maps to this file came from this file's
       * own `referenceKeys`, so it is in this set), and keeping both would have left a line no
       * mutation could reach.
       *
       * Skipping a key the file owns removes no correct row. Where two documents share a key, no
       * attribution of that key is decidable at all, and a genuine pointer at another document uses
       * that document's own key — which this set does not contain.
       */
      const ownKeys = found.has(file) ? new Set(referenceKeys(file)) : null;
      if (!keys.some((k) => content.includes(k) && !ownKeys?.has(k))) continue;
      const fromScreened = screened.has(file);
      const fromDocument = found.has(file);
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        for (const key of keys) {
          if (!lines[i].includes(key)) continue;
          // A document is not a reference to itself — asked as "is this key mine", which catches both
          // the key that maps back to this file and the key it shares with another document.
          if (ownKeys?.has(key)) continue;
          const document = keyToDoc.get(key)!;
          referencing_files.push({
            file,
            line: i + 1,
            key,
            document,
            line_text: (opts.lineText ? opts.lineText(lines[i].trim()) : lines[i].trim()).slice(0, 300),
            ...(fromScreened ? { from_screened_file: true } : {}),
            ...(fromDocument ? { from_discovered_document: true } : {}),
          });
        }
      }
    }
  }

  /* Files the walker refused, whose NAME is a declaration's name. Named individually rather than left
   * to the capped `excluded_by_walker` summary — see `DiscoverOptions.refusedByWalker`. Recorded last
   * so it can never displace a real document: these paths were never candidates and were never read.
   *
   * **Each says WHICH refusal it was, and the three are not the same statement** (F3 of the
   * 2026-09-03 verification). The first version of this labelled all of them "not text", and for two
   * of the three that is untrue: a plain-ASCII terms of service saved as `terms.rtf` is refused for
   * its EXTENSION, with the bytes never opened, and a 1.5 MB `terms.md` is refused for its SIZE and is
   * text by any test. Printing a name decision or a size decision in a byte decision's words is the
   * exact confusion this wave exists to remove, one level down — so the label is derived from the
   * reason, and only `binary-content` claims anything about the bytes. Nothing behind it changes:
   * every one of them was already named, with its reason in the sentence. */
  const REFUSAL_LABEL: Record<string, string> = {
    "binary-content": "not text",
    "binary-extension": "not read (binary extension — the bytes were never opened)",
    "size-limit": "not read (over the size ceiling)",
    // What stood at the path was not a regular file, or could not be opened.
    "named-pipe": "not read (a named pipe, never opened)",
    socket: "not read (a socket, never opened)",
    device: "not read (a device, never opened)",
    "link-to-folder": "not read (a symbolic link to a folder)",
    "link-to-nothing": "not read (a symbolic link that leads nowhere)",
    "link-to-outside": "not read (a symbolic link to a file outside the scanned folder)",
    "could-not-open": "not read (it could not be opened)",
    // The walker's own bounds.
    "link-not-followed": "not read (a symbolic link not followed: resolving it would pass the work the scan allows for links)",
    "name-not-utf8": "not read (its name is not valid UTF-8)",
    "link-path-too-long": "not read (a symbolic link not followed: a path on the way to what it names is longer than the system takes)",
    //
    "git-lfs-pointer": "not read (a Git LFS pointer: the content was never checked out)",
  };
  const REFUSAL_SENTENCE: Record<string, string> = {
    "binary-content":
      "the walker read its leading bytes and found a NUL, so it is not text. That is a statement about the encoding and never about what the file is. " +
      "Convert it to text and pass --policy <path>, or point --policy at the published page",
    "binary-extension":
      "the walker refused it for its EXTENSION and never opened it, so nothing here is a statement about its bytes: a policy published as a PDF or a Word file is a real declaration this tool cannot read, " +
      "and a plain-text file under an unexpected extension is a readable one it did not try. Convert it to text and pass --policy <path>, or point --policy at the published page",
    "size-limit":
      "the file is over the walker's size ceiling. It may be perfectly readable text; what this says is that this tool did not read it. " +
      "--policy has a ceiling of its own, so a file this large has to be split or trimmed first — or point --policy at the published page",
    //
    "git-lfs-pointer":
      "what is at that name is a Git LFS pointer, a few lines naming the content's hash and size; the content itself was never checked out, so nothing of it was read. " +
      "Fetch it with git lfs pull and scan again, or point --policy at the published page",
    // A regular file, whose NAME this tool cannot hand to the system (walk.ts `shownText`): the general sentence below
    // ("not a regular file") would be untrue of it, and --policy takes its path as text, which names another file or none.
    "name-not-utf8":
      "its name is not valid UTF-8, so this tool cannot name it to the system to open it, and nothing was read from it. " +
      "Give the file a name in UTF-8 (or copy it to one) and pass --policy <path> naming that, or point --policy at the published page",
  };
  // THE TWO FORMS OF A REFUSED PATH (walk.ts `shownText`): the declaration patterns are matched against `path`, the match
  // form, and the line names `shown`, the form a person reads. Matched against the shown form, a name that is not valid
  // UTF-8 (`\xed` written out) met a slash where its letters stood, and a Latin-1 privacy policy was named nowhere. A path whose shown form is not its text holds
  // a byte that is not valid UTF-8: it is never a document found or screened by its text, whose match form may be the
  // text of another file, so it is told apart from the others by its shown form alone.
  const shownRefused = new Set<string>();
  for (const r of opts.refusedByWalker ?? []) {
    const path = r.path.replace(/\\/g, "/");
    const asText = r.shown === undefined || r.shown === shownText(r.path);
    const file = asText ? path : (r.shown as string);
    if (asText ? found.has(path) || screened.has(path) : shownRefused.has(file)) continue;
    const glob = nameShapeGlobOf(path);
    if (!glob) continue;
    if (asText) screened.add(path);
    else shownRefused.add(file);
    content_screened.push({
      file,
      markers: [],
      screened_label: REFUSAL_LABEL[r.reason] ?? `not read (${r.reason})`,
      screened_reason:
        `its name matches the declaration pattern ${glob} and the walker refused it before discovery could read it (${r.reason}): ` +
        `${REFUSAL_SENTENCE[r.reason] ?? (NAMED_IN_FULL.has(r.reason as never) ? "what stands at that name is not a regular file the walker could open, so nothing was read from it: put the document there as a regular file, or pass --policy <path> naming the file itself" : "the walker refused it for that reason, and --policy <path> reads it anyway")}`,
    });
  }

  // Every document's own NAME shape, recorded whatever route reached it.
  // A URL has no repository path to read a name from, and is left alone.
  for (const doc of found.values()) {
    if (doc.kind !== "file") continue;
    const glob = nameShapeGlobOf(doc.path);
    if (glob) doc.name_shape_glob = glob;
    const pointer = readUrlPointer(doc.path, opts.readFile);
    if (pointer) doc.url_pointer = pointer;
  }

  const order: Record<FoundBy, number> = { explicit: 0, url: 1, glob: 2, sibling: 3, content: 4 };
  const sorted = [...found.values()].sort(
    (a, b) => order[a.found_by] - order[b.found_by] || a.path.localeCompare(b.path),
  );

  return {
    found: sorted,
    referencing_files,
    looked_at: {
      globs: DECLARATION_GLOBS,
      // Reported as a cost label and consulted by nothing (see
      // `DOCUMENT_FORMAT_EXTS`). `files_tested_by_name` is the number that answers "what did the name
      // pass reach", and it is every walked file.
      extensions: DOCUMENT_FORMAT_EXTS,
      files_walked: files.length,
      files_tested_by_name: files.length,
      files_with_declaration_extension: documentFormatFiles,
      sibling_expansions,
      reference_keys: keys,
      unreadable,
      content_scan: {
        files_read: filesReadForContent,
        marker_threshold: CONTENT_MARKER_THRESHOLD,
        matched: content_matches,
        screened: content_screened,
      },
    },
  };
}
