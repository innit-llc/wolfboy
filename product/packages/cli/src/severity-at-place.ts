/**
 * SEVERITY COMPOSED AT THE PLACE (HTTP communication is never
 * low, and the standing rule of
 * 2026-09-28 that a case weighs what is sent, whose, to whom and how - plaintext or not - never one law's applicability).
 *
 * A rule's `severity` is a fixed label: the weight of its construct when nothing else is known. At assembly the run's
 * own records know more. The per-place tables say, place by place, whether the construct is there and which personal
 * data reach it; a verdict says whether a candidate's construct stands. Two compositions follow, and both only raise:
 *
 *   (1) AT ONE CALL: personal data at the place + transport without protection = high, whatever rule raised the
 *       finding and whoever the named host is (F5): a plaintext transfer is received by everyone on the path, a
 *       connection that does not verify its peer by an active attacker on it, and one where TLS is only optional or an
 *       older version merely allowed may be read by an attacker who interferes with it (the words follow the
 *       form the place's own clause tells, `transportWords`). Whether the recipient is outside the operator changes the
 *       words, never the level.
 *   (2) ON ONE FLOW AT ONE LINE (F6): a finding of a rule whose construct is data leaving for a recipient (`FLOW_RULES`)
 *       shows the highest level any other finding of such a rule holds at the same line, with that finding named.
 *
 * The rule's own level is the floor: a finding is only ever raised by this, never made lighter, and the report shows
 * both levels in words.
 *
 * WHERE THIS IS COMPUTED, AND WHY THERE. At assembly (`assemble-report.ts`), after step 7's re-check, from the run's
 * records only: the scan document's candidates, the per-place tables the assembly itself writes, the verdicts as the
 * check left them, and the person's answer to the Vendor proxy question as the run context hands it on. The scan cannot
 * do it - at scan time no record says whether a match is the construct or which data reach it - and a seat cannot,
 * because one seat answers one rule and never sees another rule's finding at the same line. No repository text is read
 * here: a comment in the scanned tree, a file name or a value cannot raise or lower a level, because nothing of the tree
 * enters except through a record the scan or a seat wrote and the checks accepted. One such record chooses WORDS, never
 * a level: the URL scheme the scan recorded as matched at a baseline-003 location (`locations[].matched_token`),
 * from a fixed list of scheme names.
 *
 * WHAT HOLDS A PLACE (F1, F3):
 * - A row of a candidate's per-place table decided `is_the_construct` or `construct_but_gated`; `not_the_construct` and
 *   `undetermined` hold nothing. Rows of a candidate nobody answered hold their places (the rows passed the place checks;
 *   only the answer did not).
 * - For a candidate with no per-place table (no current scan writes one), each matched location of a candidate whose
 *   verdict stands (a violation candidate or needs human, not dismissed or overturned). Such a place carries the
 *   plaintext and recipient facts its rule's construct is, and NO personal data: a rule's `data_categories` say what
 *   its construct may carry, not what this run recorded at the place (F3).
 * - A candidate whose record the quote check invalidated gives NO fact, on either path, its table's rows included
 *   (F1). It can still be raised, at its matched lines, by the facts the other records hold there.
 * - A row decided `construct_but_gated` whose seat named its gate's kind `development_or_test` (the code runs only in
 *   development or in tests) holds its place - the finding stands and is shown at its rule's own level, with the seat's
 *   reason - but is NOT a place a raise rests on, in either composition: it gives no fact to another place's raise and
 *   is not raised itself. The kind is a structured field of the seat's answer, from a
 *   closed list (reading.ts `PLACE_GATE_KINDS`); the seat's `why` is prose and is not read here (a level is never chosen
 *   from words). Every other kind - a setting changed from its default, a feature or integration in use, a consent or
 *   permission check, other - opens where the product runs for someone, so such a place raises and is raised as any held
 *   place does; and so does a gated row that names no kind (every row written by an earlier version): saying too little is
 *   the failure nobody sees, saying too much is one the person can dismiss.
 *
 * WHAT COUNTS AS ONE CALL (F2), from the records only - two held places of the same file meet when:
 *   (a) they are on the same line;
 *   (b) their matched lines are one apart and the first line's quoted text shows that it goes on (
 *       `lineContinues`): a bracket or parenthesis it leaves open, or a trailing comma, operator or backslash. Two
 *       adjacent lines without that are two statements and do not meet, and so is a pair whose first line has no
 *       quotation of the matched line in its row (the legacy path, a record the quote check invalidated, a row whose
 *       quotation is of another line);
 *   (c) one's matched line lies in the span the scan folded into one construct to match the other
 *       (`locations[].joined_from`, a bracketed construct of at most 40 lines, `JOINED_VIEW_LIMITS` in derive.ts);
 *   (d) one's matched line is the definition the other's location was reached through
 *       (`locations[].resolved_from[].definition_line`): the value defined there is what the matched line uses.
 * Pairwise, never chained: every fact a raise rests on meets both the place raised and the plaintext place, so places two
 * lines apart with no held place between them, or meeting only through a third, are not one call. Not read: a location's `end_line` range (a structural element is not a call, and it can be wide - F3),
 * and a seat's own line or `beyond` (where a seat says its decision rests, not that two constructs are one call).
 *
 * WHAT COUNTS AS EACH FACT:
 * - Personal data: a held row's `data` (the six data words; a digest of an e-mail address is `email`). At a CONNECTION
 *   place (`isConnectionPlace`: a mail transport, a store connection or a TLS setting of a connection, the rules of
 *   `CONNECTION_RULES`, or a baseline-003 URL whose schemes are all of `CONNECTION_SCHEMES` - places whose rule asks
 *   what crosses them) only data
 *   that rest on a line the seat named and Read apart from the connection itself: the row's `beyond` (which the
 *   capture's C9 accepted, so the seat Read it), or the row's own line where it is a line of the window other than the
 *   matched construct (C4, C5, C7: in the window, quoted verbatim, Read). Data resting on neither are set aside, the
 *   place still held, and `dataSetAside` says which and why for the evidence log. Nothing is refused.
 * - Transport without protection: a held place of a rule in `PLAINTEXT_RULES` (the plaintext family: a URL scheme
 *   without TLS, mail without TLS or with STARTTLS optional, a service connection without TLS, a connection whose peer
 *   is not verified). The words say what each rule's place is, from `TRANSPORT_WITHOUT_PROTECTION`; where several
 *   family places hold one line, the line takes the words of the first in `FAMILY_PRECEDENCE`.
 * - A recipient outside the operator (words only): a held place of a rule in `OUTSIDE_OPERATOR_RULES`. Where the person
 *   answered the Vendor proxy question "Our own install" (`features.own_domain_endpoints` = `own_instance`), a place of
 *   a vendor that offers an edition the operator runs itself (`selfHostable`) is not one, and the words say what the
 *   person answered (F4). One answer per run, so a host is treated one way through every rule that names it.
 */
import { GATE_DEVELOPMENT_OR_TEST } from "./reading.js";
import { placeIndexOf } from "./ref-ids.js";

export type Level = "high" | "medium" | "low";

const RANK: Record<Level, number> = { high: 0, medium: 1, low: 2 };
const isLevel = (s: unknown): s is Level => s === "high" || s === "medium" || s === "low";
export const higherOf = (a: Level, b: Level): Level => (RANK[a] <= RANK[b] ? a : b);

/**
 * Rules whose held place is transport without protection: the plaintext family.
 * Four rules, and not all of them plaintext: baseline-010's
 * connection is encrypted but its peer is not verified. So each entry carries its own words, and the raise sentence of
 * (1) reads them from here, never a fixed "plain HTTP":
 *   `what`      - what the held place is (the words `FLOW_RULES` carries for the rule);
 *   `forms`     - the forms of the rule's transport a place's OWN CLAUSE can tell, each with the clauses (1-based, as
 *                 `locations[].clause` records them) that read that form and no other, and its words;
 *   `neutral`   - clauses that read every form alike and so tell nothing either way (baseline-003's case-folded
 *                 clauses read `http://` and `smtp://` with one pattern);
 *   `otherwise` - the words where the place's clauses cannot tell the form, true of every form the rule reads.
 *
 * WHY PER FORM. "Everyone on the path receives" is true where no
 * TLS is negotiated. It is not true where TLS is only optional (STARTTLS when the server offers it, `sslmode=prefer`):
 * there a passive observer receives nothing while the server offers TLS, and only an attacker who interferes with the
 * connection - stripping the offer - reads the data. Nor is "an active attacker receives" true where a version below
 * TLS 1.2 is merely allowed: a client that allows TLS 1.0 still negotiates 1.2 or 1.3 with a current server, and the
 * handshake stops an on-path attacker from forcing the lower version. So a place is given the strong words only where
 * its own clause reads that form alone; anywhere else - a clause that reads several forms (`Tls::None|Opportunistic`),
 * a setting another line can override (STARTTLS off beside implicit TLS set elsewhere), a replaced verifier whose body
 * may verify, a place whose clause is not recorded (a document written with the kind census off, a split or
 * unattributed reading) - the weaker sentence of its rule, true of every form that rule reads. The level is the same
 * either way (composition (1)); only the words differ.
 * Baseline-003's words follow the SCHEME the scan recorded as matched at
 * the place (`schemes`), not the clause number, since one case-folded clause reads `ws://`, `HTTP://` and `smtp://`
 * alike: a scheme nothing on the connection upgrades (http, ws, redis, amqp, mqtt and the like) gets the plaintext
 * words; only a scheme a STARTTLS upgrade can protect (smtp, ldap, ftp, imap, pop3, xmpp, irc, nntp) gets the weaker
 * ones. The weak words say "may" in the "Our own install" sentence too (R4). And an older version merely allowed is
 * said as what it is (R5): the connection may use a protocol version with known weaknesses where a peer negotiates
 * it - not that an attacker may read it, which its own reason above denies.
 */
export interface TransportWords {
  /** What the data travels over, as the raise sentence says it. */
  over: string;
  /** Who can read it there: the sentence's last clause, after "which". */
  reads: string;
  /** The same, after "the transport" in the "Our own install" words ("still hands ...", "may still let ..."). */
  still: string;
}
export interface TransportEntry {
  what: string;
  forms: readonly { form: string; clauses: ReadonlySet<number>; words: TransportWords }[];
  neutral?: ReadonlySet<number>;
  otherwise: TransportWords;
  /**
   * Where the place's matched text records a URL scheme, the scheme tells the form, not the clause.
   * `plaintext`: schemes nothing on the connection upgrades to TLS; `upgradable`: schemes a STARTTLS upgrade can protect.
   * A scheme in neither list is not read. Strong words only where every scheme recorded at the place is `plaintext`.
   */
  schemes?: { plaintext: ReadonlySet<string>; upgradable: ReadonlySet<string>; plaintextWords: TransportWords; upgradableWords: TransportWords };
}
const receivedBy = (who: string): Pick<TransportWords, "reads" | "still"> => ({ reads: `${who} receives`, still: `still hands the data to ${who}` });
/** True of no TLS, of optional TLS and of an unverified peer alike; not said of an older version merely allowed (R5). */
const MAY_READ: Pick<TransportWords, "reads" | "still"> = {
  reads: "an attacker who can interfere with the connection may read",
  // "may" here as in `reads`; for optional STARTTLS, a replaced verifier or a clause that cannot tell
  // the form, the reading is possible, not established.
  still: "may still let an attacker who can interfere with the connection read the data",
};
/** An older version merely allowed exposes the connection to that version's weaknesses, where a peer negotiates it. */
const OLD_VERSION: Pick<TransportWords, "reads" | "still"> = {
  reads: "may use a protocol version with known weaknesses where a peer negotiates it",
  still: "may still use a protocol version with known weaknesses where a peer negotiates it",
};
const NO_TLS_URL: TransportWords = { over: "plaintext transport", ...receivedBy("everyone on the path") };
export const TRANSPORT_WITHOUT_PROTECTION: ReadonlyMap<string, TransportEntry> = new Map<string, TransportEntry>([
  [
    "baseline-003",
    {
      what: "a URL whose scheme carries no TLS (http://, ws://, ftp://, ldap://, smtp://, redis://, amqp://, mqtt:// and the like), or an HTTP connection opened by host and port without TLS",
      // Clauses (1)-(3) spell `http://` alone, (7)-(9) a plain HTTP connection by port, construction or scheme part.
      forms: [{ form: "no_tls", clauses: new Set([1, 2, 3, 7, 8, 9]), words: NO_TLS_URL }],
      // Clauses (4)-(6) splice the scheme list: an http:// line fires them beside (1)-(3), and an smtp://, imap://,
      // pop3://, ldap:// or ftp:// line, which the connection may still upgrade to TLS, fires them alone - as does a
      // ws://, redis://, amqp://, mqtt:// or upper-case HTTP:// line, which nothing upgrades. So the clause cannot tell
      // these apart, and the scheme recorded at the place does.
      neutral: new Set([4, 5, 6]),
      otherwise: { over: "a URL whose scheme carries no TLS (some, such as smtp://, ldap:// and ftp://, may still be upgraded to TLS on the connection)", ...MAY_READ },
      // The rule's `plaintext_scheme` list, split by whether a STARTTLS upgrade on the connection can protect it.
      // `xmpp` has no `//` form and is not in the list; it is named so that the split is the parent's list as decided.
      schemes: {
        plaintext: new Set(["http", "ws", "telnet", "redis", "amqp", "mqtt", "rtmp", "rtsp", "gopher", "tftp"]),
        upgradable: new Set(["smtp", "ldap", "ftp", "imap", "pop3", "xmpp", "irc", "nntp"]),
        plaintextWords: NO_TLS_URL,
        upgradableWords: { over: "a URL whose scheme carries no TLS unless the connection is upgraded to it (STARTTLS)", ...MAY_READ },
      },
    },
  ],
  [
    "baseline-008",
    {
      what: "a mail client or mailer setting that sends without TLS, or with STARTTLS left optional",
      forms: [
        // (8b) System.Net.Mail `EnableSsl = false`: that client never negotiates TLS.
        { form: "no_tls", clauses: new Set([11]), words: { over: "a mail connection without TLS", ...receivedBy("everyone on the path to the mail server") } },
        // (1) nodemailer `secure: false` with no requireTLS, (2) its default, (8c) MailKit's `Connect(host, port, false)`:
        // STARTTLS when the server offers it.
        { form: "optional", clauses: new Set([1, 2, 19]), words: { over: "a mail connection with STARTTLS left optional", ...MAY_READ } },
      ],
      otherwise: { over: "a mail connection without TLS, with STARTTLS left optional or with the server's certificate unchecked", ...MAY_READ },
    },
  ],
  [
    "baseline-009",
    {
      what: "a database, cache, queue, search, directory, gRPC or Docker API connection without TLS, or a platform setting that allows plaintext traffic",
      // TLS switched off in the client, the store's key, Elasticsearch or OpenSearch security, a Kafka plaintext protocol
      // or listener, a gRPC channel without transport security, the Docker API's plaintext port. Not here: the modes that
      // include `prefer` or `allow` (1), (2), (1b); a URL whose driver picks the default (14); an LDAP client StartTLS
      // may follow (9); STARTTLS off beside a TLS URL set elsewhere (10); a platform PERMISSION for plaintext (12), (13),
      // (12c), which allows it without making a connection plaintext.
      forms: [
        {
          form: "no_tls",
          clauses: new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 29]),
          words: { over: "a service connection without TLS", ...receivedBy("everyone on the network path") },
        },
      ],
      otherwise: { over: "a service connection or platform setting without TLS, or with merely preferred TLS an active attacker can strip", ...MAY_READ },
    },
  ],
  [
    "baseline-010",
    {
      what: "certificate or host-name verification turned off or replaced, or a protocol version below TLS 1.2 allowed",
      forms: [
        // Verification switched OFF: (1), (2), (4)-(8), (13), (15), (15b), (5b), (6b). Not here: a REPLACED verifier, whose
        // body may verify (3), (9)-(12), (14), (11b), (12b).
        {
          form: "unverified",
          clauses: new Set([1, 2, 4, 5, 6, 7, 8, 13, 15, 24, 25, 28]),
          words: { over: "a connection that is encrypted but does not verify its peer", ...receivedBy("an active attacker on the path") },
        },
        // (16)-(23): a version below TLS 1.2 allowed (or pinned), which a current peer does not negotiate.
        { form: "old_version", clauses: new Set([16, 17, 18, 19, 20, 21, 22, 23]), words: { over: "a connection that allows a protocol version below TLS 1.2", ...OLD_VERSION } },
      ],
      // True of every form this rule reads: the attacker's reading for verification off or replaced, the version's
      // weaknesses for a version allowed (R5).
      otherwise: {
        over: "a connection whose peer verification is turned off or replaced, or which allows a protocol version below TLS 1.2",
        reads: `${MAY_READ.reads}, or which ${OLD_VERSION.reads}`,
        still: `${MAY_READ.still}, or ${OLD_VERSION.still.replace(/^may still /, "")}`,
      },
    },
  ],
]);

/** The URL schemes of a location's matched text - the first scheme of each matched span. */
export function schemesOf(matched: string | null | undefined): string[] {
  if (typeof matched !== "string" || matched === "") return [];
  const out: string[] = [];
  for (const span of matched.split("+")) {
    const m = /(?<![a-z0-9+.])([a-z][a-z0-9+.]*):\/\//i.exec(span);
    if (m) out.push(m[1]!.toLowerCase());
  }
  return out;
}

/**
 * The words for a held place of a rule of the family: the form its recorded scheme tells (baseline-003, R3), else the
 * form its own clauses tell, else the words true of every form of its rule.
 */
export function transportWords(ruleId: string, clauses: readonly number[] | undefined, matched?: string | null): TransportWords {
  const t = TRANSPORT_WITHOUT_PROTECTION.get(ruleId) as TransportEntry;
  if (t.schemes && clauses !== undefined) {
    const s = t.schemes;
    const read = schemesOf(matched).filter((x) => s.plaintext.has(x) || s.upgradable.has(x));
    if (read.length > 0) return read.every((x) => s.plaintext.has(x)) ? s.plaintextWords : s.upgradableWords;
  }
  const told = (clauses ?? []).filter((n) => !t.neutral?.has(n));
  if (told.length > 0) for (const f of t.forms) if (told.every((n) => f.clauses.has(n))) return f.words;
  return t.otherwise;
}

/**
 * Where several family places hold ONE line, the line takes the words of the first of them in this
 * fixed order - never the candidates' order. The order puts first the reading that knows the line's transport most
 * directly, because where two readings of one line disagree the more direct one is the true one, and its words are the
 * strongest that are true of the line:
 *   0. baseline-003 where its recorded scheme or clause tells the plaintext form: an http:// URL, a scheme nothing
 *      upgrades, or plain HTTP by port - the line's own transport, which nothing on the line can make TLS;
 *   1. baseline-008, the mail client's own semantics: MailKit's `Connect(host, 25, useSsl: false)` is STARTTLS when
 *      offered, which a generic reading of `useSsl: false` as no TLS (baseline-009) overstates;
 *   2. baseline-009, a service connection's own TLS setting: where it switches TLS off, a verification setting beside it
 *      (baseline-010) has nothing to verify;
 *   3. baseline-010, the verification and version settings of a TLS connection;
 *   4. baseline-003 otherwise: a scheme a STARTTLS upgrade can protect, or a clause that cannot tell.
 * Ties (two findings of one rule at one line) go by finding_id.
 */
export function familyRank(ruleId: string, clauses: readonly number[] | undefined, matched?: string | null): number {
  if (ruleId === "baseline-003") return transportWords(ruleId, clauses, matched) === NO_TLS_URL ? 0 : 4;
  return ruleId === "baseline-008" ? 1 : ruleId === "baseline-009" ? 2 : ruleId === "baseline-010" ? 3 : 5;
}
export const FAMILY_PRECEDENCE: readonly string[] = ["baseline-003 (plaintext form)", "baseline-008", "baseline-009", "baseline-010", "baseline-003 (otherwise)"];

/**
 * The rules whose place IS a connection or a setting of one - a mail transport, a database, cache, queue
 * or directory connection, and a connection's TLS verification or version setting -
 * and whose questions ask what crosses it. A connection line shows how data travel, not which: their places' `data`
 * count only where the row names a line that shows them (`connectionDataUnrested`).
 */
export const CONNECTION_RULES: ReadonlySet<string> = new Set(["baseline-008", "baseline-009", "baseline-010"]);

/**
 * The schemes of baseline-003 whose URL names a connection - to a cache, queue or
 * broker, a mail, directory, file or stream server, a terminal - rather than a request: the rule's scheme lists less
 * the request schemes. A held baseline-003 place whose recorded schemes (`locations[].matched_token`, read as for R3)
 * are all of these is a connection place, as the rules above are. An http://, ws:// or gopher:// URL is a request
 * line, which can itself show what it carries, and stays outside; so does a place with any request scheme among its
 * spans, with no scheme recorded (clauses 7-9), or with a prefixed reading, whose matched text is the whole line.
 */
const REQUEST_SCHEMES: ReadonlySet<string> = new Set(["http", "ws", "gopher"]);
export const CONNECTION_SCHEMES: ReadonlySet<string> = (() => {
  const s = (TRANSPORT_WITHOUT_PROTECTION.get("baseline-003") as TransportEntry).schemes!;
  return new Set([...s.plaintext, ...s.upgradable].filter((x) => !REQUEST_SCHEMES.has(x)));
})();

/** Whether a held place of this rule, with this matched text, is a connection place. */
export function isConnectionPlace(ruleId: string, matched?: string | null): boolean {
  if (CONNECTION_RULES.has(ruleId)) return true;
  if (ruleId !== "baseline-003") return false;
  const read = schemesOf(matched);
  // EVERY matched span must name a connection scheme. A span with no scheme is
  // a plain HTTP request by host and port (clauses 7-9) - `net::http.new+redis://` is a redis:// URL and a port-80
  // request on one line - and a request line can itself show what it carries, so such a place stays outside.
  const spans = typeof matched === "string" ? matched.split("+").filter((x) => x !== "").length : 0;
  return read.length > 0 && read.length === spans && read.every((x) => CONNECTION_SCHEMES.has(x));
}

/** Rules whose held place is transport without protection, with what the place is: a view of the map above. */
export const PLAINTEXT_RULES: ReadonlyMap<string, string> = new Map([...TRANSPORT_WITHOUT_PROTECTION].map(([id, t]) => [id, t.what]));

/**
 * Rules whose held place names a recipient outside the operator: a vendor or a host the operator did not choose is the
 * construct itself. Every id must name a rule of the bundle (the gate `test:assemble-report` checks it), so a renamed
 * rule cannot drop out of this list silently. recipients-003 (a destination held in the code) is here since a later change
 * (F4): it counts as outside on the same terms as the vendor rules - a host such as `hog.example.org` is PostHog's
 * service through eu-consent-004 and a held destination through recipients-003, and is treated one way in a run.
 */
export const OUTSIDE_OPERATOR_RULES: ReadonlyMap<string, string> = new Map([
  ["recipients-001", "a payment vendor named in the tree"],
  ["recipients-002", "a storage, delivery or picture-serving vendor named in the tree"],
  ["recipients-003", "a destination held in the code"],
  ["recipients-004", "an identity or access vendor named in the tree"],
  ["recipients-005", "an e-mail or team-chat vendor named in the tree"],
  ["recipients-006", "an analytics, avatar-image, audit-log, session-replay or error-monitoring vendor named in the tree"],
  ["recipients-014", "a counterpart an identifier is synchronised with"],
  ["eu-consent-001", "the Google Tag Manager or GA4 host"],
  ["eu-consent-002", "Meta's pixel host"],
  ["eu-consent-003", "TikTok's pixel host"],
  ["eu-consent-004", "PostHog"],
  ["eu-consent-005", "a session-replay vendor"],
  ["eu-consent-006", "a third-party asset host"],
  ["eu-consent-007", "YouTube"],
  ["eu-consent-008", "AdSense"],
  ["eu-consent-013", "an analytics vendor"],
  ["eu-consent-015", "an ad network host"],
  ["eu-consent-019", "Meta (the Facebook SDK)"],
  ["eu-consent-023", "a third-party script host"],
  ["federation-001", "a remote server chosen by protocol data"],
  ["identity-issuance-002", "a directory or application of another domain"],
]);

/**
 * F4: rules whose recipient may be software the operator runs itself. A place of one of these is not "outside the
 * operator" where the person answered "Our own install". `true`: the whole rule (PostHog, which offers a self-hosted
 * edition; a destination held in the code; the analytics and session-replay rules, whose vendors include Matomo,
 * Plausible, OpenReplay and LogRocket, and whose places carry no item to tell the vendor by). A pattern: only a place
 * whose program item names one of the ten vendors recipients-006's context question 3 lists as offering an edition the
 * operator runs (read on each vendor's own page, 2026-10-06); any other vendor of that rule - Gravatar, Mixpanel,
 * Datadog - stays outside whatever the answer.
 */
export const SELF_HOSTABLE_RULES: ReadonlyMap<string, true | RegExp> = new Map<string, true | RegExp>([
  ["eu-consent-004", true],
  ["eu-consent-005", true],
  ["eu-consent-013", true],
  ["recipients-003", true],
  ["recipients-006", /posthog|plausible|matomo|sentry|openreplay|logrocket|bugsnag|retraced|dicebear|wsrv/i],
]);

/**
 * F6: rules whose construct is data leaving the product for a recipient - one flow where two of them hold the same
 * line. A duty that is not a sending (an erasure path, a statement of reasons, a value written to the device, a claim)
 * is not here, so it never takes another rule's level.
 */
export const FLOW_RULES: ReadonlyMap<string, string> = new Map([
  ...PLAINTEXT_RULES,
  ...OUTSIDE_OPERATOR_RULES,
  ["recipients-008", "a first-party telemetry beacon"],
  ["recipients-009", "a per-recipient identifier in a pixel or redirect URL"],
  ["recipients-010", "personal data over a non-HTTP transport or in a media URL"],
  ["recipients-013", "telemetry to a first-party or configured endpoint"],
  ["identity-issuance-001", "user attributes released to a relying party"],
  ["ai-inference-001", "identity or content forwarded to a model endpoint"],
  ["ai-inference-002", "identity headers added to an inference request"],
  ["ai-inference-005", "an outbound request with the user's credential"],
  ["baseline-006", "a secret in a URL query built for sending"],
  ["eu-consent-011", "send-default-PII to the monitoring host"],
  ["eu-consent-014", "a script or pixel placement"],
]);

/** The decisions of a per-place row that hold the place: the construct is there. */
const HOLDING_DECISIONS = new Set(["is_the_construct", "construct_but_gated"]);

/** The six data words of a place row (place-reply.ts `PLACE_DATA_WORDS`), in the words the report uses. */
const DATA_WORDS: Record<string, string> = {
  email: "an e-mail address or a value derived from it",
  name: "a person's name",
  user_id: "a user identifier",
  ip_or_device: "an IP address or device identifier",
  user_content: "what a person wrote or uploaded",
  other_personal: "other personal data",
};

export interface PlaceRowIn {
  place?: string;
  file: string;
  line: number;
  decision?: string;
  data?: readonly string[];
  item?: string;
  program_item?: string;
  /** The seat's quotation and the lines it is of (`line_decided`, "N" or "N-M"); V6 reads the matched line's text from them. */
  quote?: string;
  /** The seat's own line (C4: a line of the place's window; a fact place: its matched line), as the table writes it. */
  line_decided?: string | number;
  /** The line outside the window the row rests on, present only where the capture's C9 accepted it (the seat Read it). */
  beyond?: { file: string; line: number; quote?: string } | null;
  /** The gate's kind the seat named on a `construct_but_gated` row (reading.ts `PLACE_GATE_KINDS`). */
  gate?: string;
}

/** The data of a connection place's row that the composition set aside, and why, for the evidence log. */
export interface DataSetAside {
  finding_id: string;
  rule_id: string;
  file: string;
  line: number;
  data: string[];
  why: string;
}

export interface LocationIn {
  file: string;
  start_line: number;
  end_line?: number | null;
  joined_from?: { start_line: number; end_line: number } | null;
  resolved_from?: readonly { definition_line?: number }[] | null;
  /** Which of the rule's clauses fired on this line (`"16"`, `"1,3"`), or a prefixed reading that names none. */
  clause?: string | null;
  /** What the clauses matched, folded (the URL scheme in it chooses baseline-003's words). */
  matched_token?: string | null;
}

export interface CandidateIn {
  finding_id: string;
  rule_id: string;
  severity: string;
  data_categories?: readonly string[];
  locations: readonly LocationIn[];
}

export interface ComposeInput {
  candidates: readonly CandidateIn[];
  /** The per-place table of every candidate read by the place plan, by finding_id. */
  rows: ReadonlyMap<string, readonly PlaceRowIn[]>;
  /** Candidates with no per-place table whose verdict stands (violation candidate or needs human, not overturned). */
  verdictHeld: ReadonlySet<string>;
  /** Candidates whose record the quote check invalidated (F1): they give no fact, on either path. */
  invalidated?: ReadonlySet<string>;
  /** True where the person answered the Vendor proxy question "Our own install" (F4). */
  ownInstance?: boolean;
}

type Meet = "same_line" | "next_line" | "joined" | "resolved";

interface Held {
  finding_id: string;
  rule_id: string;
  file: string;
  /** The matched line. */
  at: number;
  /** The span the scan folded to match this location (`joined_from`). */
  span?: [number, number];
  /** The definition lines this location was reached through (`resolved_from`). */
  defs: number[];
  /** Data words of the row (the six); none on a place with no row. */
  data: string[];
  /** False: the place may be raised but gives no fact (a record the quote check invalidated, F1). */
  facts: boolean;
  /**
   * The seat decided this place `construct_but_gated` and named the gate's kind
   * `development_or_test` - the construct is here and runs only in development or in tests. The place stays held (its
   * finding is shown, at its rule's own level), but no raise rests on it and it is not raised: see `composeSeverities`.
   * A gated row of any other kind, or of none, is not marked: it raises as any held place does.
   */
  gated?: true;
  /** The row's own line, where a connection place's data rest on it (not on `beyond`). */
  dataOnOwnLine?: number;
  /** The rule's clauses that fired at this location (`locations[].clause`, 1-based), where the scan recorded numbers. */
  clauses?: number[];
  /** The matched text, where the clauses are numbered (`locations[].matched_token`). */
  matched?: string;
  item?: string;
  program_item?: string;
  /** The matched line's text, from the row's quotation where it is of that line (V6); none elsewhere. */
  text?: string;
}

/** One finding raised above its rule's own level, as the log's `severity_raised[]` records it. */
export interface SeverityRaise {
  finding_id: string;
  rule_id: string;
  rule_severity: Level;
  severity: Level;
  /** `place`: personal data over transport without protection at one call; `flow`: another finding of the same flow at the same line. */
  /** `standing`: raised by weight from the review's `standing` block (fix-order.ts, D1 = B). */
  basis: "place" | "flow" | "standing";
  file: string;
  line: number;
  /** The last line of the call where its places span more than one line. */
  to_line?: number;
  /** How the places of the call meet, where they are not all on one line (F2). */
  call?: Meet[];
  data: string[];
  recipient?: { finding_id: string; rule_id: string; item?: string; line: number; own_install?: true };
  plaintext?: { finding_id: string; rule_id: string; line: number };
  flow?: { finding_id: string; rule_id: string; severity: Level };
  /** The parts a raise by weight rests on, as the review's block gave them. */
  standing?: { order_tier: "O1" | "O2"; duty: string[]; data: string[]; people: string[]; runs: string; reaches: string; ships: string };
  because: string;
}

const inSpan = (n: number, s?: [number, number]): boolean => !!s && s[0] <= n && n <= s[1];

/**
 * V6: whether a line's text shows that its call or statement goes on to the next line - a bracket or
 * parenthesis it opens and does not close, or a trailing comma, backslash or operator (`+ - * / % = & | ^ < > ? .`, and
 * the words `and`, `or`). Counted over the text as written: a bracket inside a string or a comment is counted too, and a
 * trailing comment hides the line's last character. A trailing colon is not read as going on (a block's head).
 */
export function lineContinues(text: string): boolean {
  const t = text.replace(/\s+$/u, "");
  if (t === "") return false;
  let open = 0;
  for (const ch of t) {
    if (ch === "(" || ch === "[" || ch === "{") open += 1;
    else if (ch === ")" || ch === "]" || ch === "}") open -= 1;
  }
  return open > 0 || /(?:[,\\([{+\-*/%=&|^<>?.]|\b(?:and|or))$/u.test(t);
}

/** The matched line's text from a row's quotation (V6): the quotation's line for that line where `line_decided` covers it. */
function quotedLineOf(r: PlaceRowIn): string | undefined {
  if (typeof r.quote !== "string" || r.quote === "") return undefined;
  const lines = r.quote.split(/\r?\n/u);
  const ld = r.line_decided === undefined ? undefined : String(r.line_decided).trim();
  const d = ld === undefined ? null : /^(\d+)(?:-(\d+))?$/u.exec(ld);
  if (ld === undefined || ld === "") return lines.length === 1 ? lines[0] : undefined;
  if (!d) return undefined;
  const from = Number(d[1]);
  const to = d[2] === undefined ? from : Number(d[2]);
  if (r.line < from || r.line > to || lines.length !== to - from + 1) return undefined;
  return lines[r.line - from];
}

/** How two held places of one file meet as one call, or null (F2). Pairwise; never through a third place. */
function meet(h: Held, g: Held): Meet | null {
  if (h.file !== g.file) return null;
  if (h.at === g.at) return "same_line";
  if (Math.abs(h.at - g.at) === 1) {
    const first = h.at < g.at ? h : g;
    if (first.text !== undefined && lineContinues(first.text)) return "next_line";
  }
  if (inSpan(g.at, h.span) || inSpan(h.at, g.span)) return "joined";
  if (h.defs.includes(g.at) || g.defs.includes(h.at)) return "resolved";
  return null;
}

/**
 * Whether a connection place's `data` rest on a line the seat named and Read apart from the connection
 * itself - `beyond` (C9 accepted it: in the tree, quoted verbatim, covered by the seat's own Read), or the seat's own line
 * where it is a line of the window outside the matched construct (C4, C5, C7). Null where they rest; else why not.
 */
const restsOnBeyond = (r: PlaceRowIn): boolean => {
  const b = r.beyond;
  return !!b && typeof b.file === "string" && b.file !== "" && Number.isInteger(b.line);
};
function connectionDataUnrested(r: PlaceRowIn, span: [number, number] | undefined): string | null {
  if (restsOnBeyond(r)) return null;
  const own = Number(r.line_decided);
  if (Number.isInteger(own) && own > 0 && own !== r.line && !inSpan(own, span)) return null;
  return (
    `the seat named no line showing these data apart from the connection itself: no \`beyond\` line (which C9 holds to a line the seat Read) ` +
    `and no line of the window outside the matched construct (its own line is ${Number.isInteger(own) && own > 0 ? `line ${own}` : "not recorded"}); ` +
    `a connection line shows how data travel, not which, so these data do not raise this place; it is still held, and another place of this call ` +
    `can still raise it on data a named line shows`
  );
}

function heldPlaces(input: ComposeInput, aside?: DataSetAside[]): Held[] {
  const out: Held[] = [];
  const invalid = input.invalidated ?? new Set<string>();
  const shape = (l: LocationIn | undefined) => {
    const j = l?.joined_from;
    const span: [number, number] | undefined = j && Number.isInteger(j.start_line) && Number.isInteger(j.end_line) && j.end_line >= j.start_line ? [j.start_line, j.end_line] : undefined;
    const defs = (l?.resolved_from ?? []).map((r) => Number(r?.definition_line)).filter((n) => Number.isInteger(n) && n > 0);
    // Only a plain list of clause numbers tells the form; a prefixed reading (`joined:`, `unattributed:`, `raw:`) does not.
    const clauses = typeof l?.clause === "string" && /^\d+(?:,\d+)*$/.test(l.clause) ? l.clause.split(",").map(Number) : undefined;
    // The matched text only beside numbered clauses: with a prefixed reading it is the whole line folded, not the match.
    const matched = clauses && typeof l?.matched_token === "string" ? l.matched_token : undefined;
    return { ...(span ? { span } : {}), defs, ...(clauses ? { clauses } : {}), ...(matched !== undefined ? { matched } : {}) };
  };
  for (const c of input.candidates) {
    // F1: a record the quote check invalidated gives nothing; its finding may still be raised at its matched lines.
    if (invalid.has(c.finding_id)) {
      for (const l of c.locations) out.push({ finding_id: c.finding_id, rule_id: c.rule_id, file: l.file, at: Number(l.start_line), ...shape(l), data: [], facts: false });
      continue;
    }
    const rows = input.rows.get(c.finding_id);
    if (rows) {
      rows.forEach((r, i) => {
        if (!HOLDING_DECISIONS.has(String(r.decision ?? ""))) return;
        const n = placeIndexOf(r.place) ?? i;
        const loc = c.locations[n];
        const shaped = loc && loc.file === r.file && Number(loc.start_line) === r.line ? shape(loc) : { defs: [] };
        let data = [...new Set((r.data ?? []).filter((d) => typeof d === "string" && d in DATA_WORDS))];
        let dataOnOwnLine: number | undefined;
        if (data.length > 0 && isConnectionPlace(c.rule_id, (shaped as { matched?: string }).matched)) {
          const why = connectionDataUnrested(r, (shaped as { span?: [number, number] }).span);
          if (why !== null) {
            aside?.push({ finding_id: c.finding_id, rule_id: c.rule_id, file: r.file, line: r.line, data: [...data].sort(), why });
            data = [];
          } else if (!restsOnBeyond(r)) dataOnOwnLine = Number(r.line_decided);
        }
        out.push({
          finding_id: c.finding_id,
          rule_id: c.rule_id,
          file: r.file,
          at: r.line,
          ...shaped,
          data,
          facts: true,
          ...(r.decision === "construct_but_gated" && r.gate === GATE_DEVELOPMENT_OR_TEST ? { gated: true as const } : {}),
          ...(dataOnOwnLine !== undefined ? { dataOnOwnLine } : {}),
          ...(r.item ? { item: r.item } : {}),
          ...(r.program_item ? { program_item: r.program_item } : {}),
          ...(quotedLineOf(r) !== undefined ? { text: quotedLineOf(r) } : {}),
        });
      });
      continue;
    }
    if (!input.verdictHeld.has(c.finding_id)) continue;
    // F3: no personal data from the rule's categories; the place is held at its matched line, never a range.
    for (const l of c.locations) out.push({ finding_id: c.finding_id, rule_id: c.rule_id, file: l.file, at: Number(l.start_line), ...shape(l), data: [], facts: true });
  }
  /* In one call, the line a connection place's row names for its data is the
   * connection itself where it is the matched line of ANOTHER connection place of the call, or inside the span the scan
   * joined to match that place - one answer for every place of the call, not one per place. Such data are set aside as
   * the row-by-row reading above sets them aside for the place's own span; the place stays held. */
  for (const h of out) {
    if (h.dataOnOwnLine === undefined || h.data.length === 0) continue;
    const own = h.dataOnOwnLine;
    const q = out.find((g) => g !== h && g.file === h.file && isConnectionPlace(g.rule_id, g.matched) && (g.at === own || inSpan(own, g.span)) && meet(h, g) !== null);
    if (!q) continue;
    aside?.push({
      finding_id: h.finding_id,
      rule_id: h.rule_id,
      file: h.file,
      line: h.at,
      data: [...h.data].sort(),
      why:
        `the line the seat named for these data (line ${own}) is ${q.at === own ? "the matched line" : "inside the construct the scan joined"} of another connection place of this call ` +
        `(${q.rule_id} at line ${q.at}): a connection line shows how data travel, not which, so these data do not raise this place; it is still held, ` +
        `and another place of this call can still raise it on data a named line shows`,
    });
    h.data = [];
  }
  return out;
}

function selfHostable(g: Held): boolean {
  const s = SELF_HOSTABLE_RULES.get(g.rule_id);
  if (s === undefined) return false;
  if (s === true) return true;
  return s.test(g.program_item ?? "") || s.test(g.item ?? "");
}

const MEET_WORDS: Record<Exclude<Meet, "same_line">, string> = {
  next_line: "a call or statement continued on the next line",
  joined: "one construct the scan joined over lines",
  resolved: "a value defined on one line and used on the other",
};

/**
 * Every finding the facts at its places raise above its rule's own level, by finding_id. Where several of a finding's
 * places raise it, the highest level is kept; of equal ones the call over the fewest lines, then the first by file and
 * line.
 */
export function composeSeverities(input: ComposeInput): Map<string, SeverityRaise> {
  const held = heldPlaces(input);
  const byFile = new Map<string, Held[]>();
  for (const h of held) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h]);
  const ruleLevel = new Map(input.candidates.map((c) => [c.finding_id, c.severity] as const));
  const out = new Map<string, SeverityRaise>();
  const sorted = [...held].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.at - b.at || (a.finding_id < b.finding_id ? -1 : a.finding_id > b.finding_id ? 1 : 0)));
  const ownInstall = (g: Held): boolean => input.ownInstance === true && selfHostable(g);
  /** The places (1) raised: a finding holds the composed level at these lines only, never at its other places. */
  const placeRaised = new Map<string, Level>();
  const keyOf = (g: Held) => `${g.finding_id}\u0000${g.file}\u0000${g.at}`;

  /* (1) AT ONE CALL: personal data + transport without protection = high (F5): a place its seat
   * decided `construct_but_gated` with the gate `development_or_test` is neither raised nor a fact of another place's
   * raise (the header, WHAT HOLDS A PLACE). */
  for (const h of sorted) {
    const own = ruleLevel.get(h.finding_id);
    if (!isLevel(own) || h.gated) continue;
    // The places of this call, those on this very line first, so the words name the narrowest call that holds the facts.
    const here = (byFile.get(h.file) ?? [])
      .map((g) => ({ g, how: meet(h, g) }))
      .filter((x): x is { g: Held; how: Meet } => x.how !== null && x.g.facts && !x.g.gated)
      .sort((x, y) => Number(x.how !== "same_line") - Number(y.how !== "same_line"));
    // Pairwise: every fact of the call meets this place AND the plaintext place, so two facts that meet only through
    // a third never compose (F2). The first plaintext place, nearest first, with personal data that meets it.
    let plain: { g: Held; how: Meet } | undefined;
    let personal: { g: Held; how: Meet }[] = [];
    for (const p of here.filter((x) => PLAINTEXT_RULES.has(x.g.rule_id))) {
      const withData = here.filter((x) => x.g.data.length > 0 && meet(x.g, p.g) !== null);
      if (withData.length === 0) continue;
      plain = p;
      personal = withData.some((x) => x.how === "same_line") ? withData.filter((x) => x.how === "same_line") : withData;
      break;
    }
    if (personal.length === 0 || !plain) continue;
    // R6: where several family places hold the plaintext place's line, the line's words are those of the first of
    // them in the fixed precedence (`familyRank`), never the first in the candidates' order; that place is the one named.
    // Pairwise still: only a family place that meets every personal-data place of the call can be the one named.
    const atLine = here.filter((x) => PLAINTEXT_RULES.has(x.g.rule_id) && x.g.at === plain!.g.at && personal.every((d) => meet(d.g, x.g) !== null));
    const rankOf = (g: Held) => familyRank(g.rule_id, g.clauses, g.matched);
    atLine.sort((x, y) => rankOf(x.g) - rankOf(y.g) || (x.g.finding_id < y.g.finding_id ? -1 : x.g.finding_id > y.g.finding_id ? 1 : 0));
    if (atLine.length > 0) plain = atLine[0]!;
    const call = plain.g;
    const level = higherOf(own, "high");
    if (level === own) continue;
    placeRaised.set(keyOf(h), level);
    const inCall = (x: { g: Held }) => meet(x.g, call) !== null;
    // A named vendor before a destination the code merely holds (recipients-003), so the words name the recipient.
    const named = (x: { g: Held }) => (x.g.rule_id === "recipients-003" ? 1 : 0);
    const recipients = [...here].sort((x, y) => named(x) - named(y));
    const outside = recipients.find((x) => OUTSIDE_OPERATOR_RULES.has(x.g.rule_id) && !ownInstall(x.g) && inCall(x));
    const ownRun = outside ? undefined : recipients.find((x) => OUTSIDE_OPERATOR_RULES.has(x.g.rule_id) && ownInstall(x.g) && inCall(x));
    const used = [{ g: h, how: "same_line" as Meet }, ...personal, plain, ...(outside ? [outside] : []), ...(ownRun ? [ownRun] : [])];
    const lines = used.map((x) => x.g.at);
    const from = Math.min(...lines);
    const to = Math.max(...lines);
    const how = [...new Set(used.flatMap((x) => [x.how, meet(x.g, call) ?? "same_line"]).filter((m): m is Exclude<Meet, "same_line"> => m !== "same_line"))].sort();
    const lineOf = (g: Held) => (from === to ? "" : ` at line ${g.at}`);
    // Of a finding's places that raise it, the highest level is kept; of equal ones the call over fewest lines, then the first.
    const prev = out.get(h.finding_id);
    if (prev && (RANK[prev.severity] < RANK[level] || (prev.severity === level && (prev.to_line ?? prev.line) - prev.line <= to - from))) continue;
    const where = from === to ? `\`${h.file}:${from}\`` : `\`${h.file}\` lines ${from}-${to} (one call by this run's records: ${how.map((m) => MEET_WORDS[m]).join("; ")})`;
    const words = [...new Set(personal.flatMap((x) => x.g.data))].sort();
    // What the data travels over and who receives it there, as the plaintext place's own rule says it.
    const transport = transportWords(plain.g.rule_id, plain.g.clauses, plain.g.matched);
    const recipientWords = outside
      ? `; the recipient is outside the operator (${outside.g.item && outside.g.rule_id !== "recipients-003" ? `${outside.g.item}, ` : ""}named by ${outside.g.rule_id}${lineOf(outside.g)})`
      : ownRun
        ? `; the recipient named by ${ownRun.g.rule_id}${lineOf(ownRun.g)} may be software the person runs (they answered the Vendor proxy question "Our own install"), and the transport ${transport.still}`
        : "";
    const because =
      `personal data (${words.map((w) => DATA_WORDS[w] ?? w).join("; ")}) reaches ${where} over ${transport.over} (${plain.g.rule_id}${lineOf(plain.g)}), ` +
      `which ${transport.reads}${recipientWords}, as this run's records hold it; the rule's own level is ${own}`;
    const r = outside ?? ownRun;
    out.set(h.finding_id, {
      finding_id: h.finding_id,
      rule_id: h.rule_id,
      rule_severity: own,
      severity: level,
      basis: "place",
      file: h.file,
      line: from,
      ...(to !== from ? { to_line: to, call: how } : {}),
      data: words,
      ...(r ? { recipient: { finding_id: r.g.finding_id, rule_id: r.g.rule_id, ...(r.g.item ? { item: r.g.item } : {}), line: r.g.at, ...(ownRun ? { own_install: true as const } : {}) } } : {}),
      plaintext: { finding_id: plain.g.finding_id, rule_id: plain.g.rule_id, line: plain.g.at },
      because,
    });
  }

  /* (2) ON ONE FLOW AT ONE LINE: the highest level a finding of the same flow holds AT THAT LINE (F6) - its rule's own
   * level, or the level (1) composed at a call that holds this very place; never a level the finding reached at another
   * place. The levels read are those after (1) and never after (2), so a level travels one line's group and no further. */
  const levelAt = (g: Held): Level | null => {
    const own = ruleLevel.get(g.finding_id);
    if (!isLevel(own)) return null;
    return placeRaised.get(keyOf(g)) ?? own;
  };
  const flowRaises = new Map<string, SeverityRaise>();
  for (const h of sorted) {
    const own = ruleLevel.get(h.finding_id);
    if (!isLevel(own) || !FLOW_RULES.has(h.rule_id) || h.gated) continue;
    const current = flowRaises.get(h.finding_id)?.severity ?? out.get(h.finding_id)?.severity ?? own;
    let top: { g: Held; level: Level } | undefined;
    for (const g of byFile.get(h.file) ?? []) {
      if (!g.facts || g.gated || g.at !== h.at || g.finding_id === h.finding_id || !FLOW_RULES.has(g.rule_id)) continue;
      const lv = levelAt(g);
      if (lv && (!top || RANK[lv] < RANK[top.level])) top = { g, level: lv };
    }
    if (!top || RANK[top.level] >= RANK[current]) continue;
    const how = placeRaised.has(keyOf(top.g)) ? "as composed at this place" : "its rule's own level";
    flowRaises.set(h.finding_id, {
      finding_id: h.finding_id,
      rule_id: h.rule_id,
      rule_severity: own,
      severity: top.level,
      basis: "flow",
      file: h.file,
      line: h.at,
      data: [...new Set((byFile.get(h.file) ?? []).filter((g) => g.facts && !g.gated && g.at === h.at).flatMap((g) => g.data))].sort(),
      flow: { finding_id: top.g.finding_id, rule_id: top.g.rule_id, severity: top.level },
      because:
        `${top.g.rule_id} (${FLOW_RULES.get(top.g.rule_id)}) holds the same flow at \`${h.file}:${h.at}\` and is ${top.level} there (${how}), ` +
        `as this run's records hold it; the rule's own level is ${own}`,
    });
  }
  for (const [id, r] of flowRaises) out.set(id, r);
  return out;
}

/**
 * The transport a held place of the plaintext family establishes, in its rule's words for that form
 * (`transportWords`: plain transport, a connection that does not verify its peer, a version merely allowed, mail with
 * STARTTLS optional, ...), looked up by finding, file and matched line - the words a raise's `because` gives its
 * plaintext place, for every other line that speaks of that place (the report's first screen). Null where no held place
 * of a family rule is there: a place that is no transport has no transport words, and nothing says "plain HTTP" of it.
 * Where one finding holds two places on one line, the one the composition would name (`familyRank`) is taken.
 */
export function transportWordsAt(input: ComposeInput): (findingId: string, file: string, line: number) => TransportWords | null {
  const by = new Map<string, Held>();
  for (const h of heldPlaces(input)) {
    if (!PLAINTEXT_RULES.has(h.rule_id)) continue;
    const k = `${h.finding_id}\u0000${h.file}\u0000${h.at}`;
    const prev = by.get(k);
    if (!prev || familyRank(h.rule_id, h.clauses, h.matched) < familyRank(prev.rule_id, prev.clauses, prev.matched)) by.set(k, h);
  }
  return (findingId, file, line) => {
    const h = by.get(`${findingId}\u0000${file}\u0000${line}`);
    return h ? transportWords(h.rule_id, h.clauses, h.matched) : null;
  };
}

/**
 * The data of connection places (`isConnectionPlace`) that the composition set aside because they rest on
 * no line the seat named apart from the connection itself, in file and line order - the evidence log's
 * `data_set_aside[]`. The places stay held; only these data do not raise them. Nothing here refuses a row: the capture
 * already holds every `beyond` it keeps to a line the seat Read (C9), and every row's own line to the window (C4-C7).
 */
export function dataSetAside(input: ComposeInput): DataSetAside[] {
  const aside: DataSetAside[] = [];
  heldPlaces(input, aside);
  return aside.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.finding_id < b.finding_id ? -1 : 1)));
}
