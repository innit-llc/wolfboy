# Example Book Club: a demo to scan

A very small sign-up app (in `app/`), written for this repository, with a few compliance problems planted on
purpose. Scan it to see what the scanner reports before you point it at your own code. Every person,
address and company in it is made up; the analytics, ad, avatar and AI services it calls are real ones, so that the
scan can recognise them. In its own documents (`app/INSTALL.md`), a company in Berlin sells the app to book
clubs in the EU, and only there, and each club installs and runs it on its own server.

## Scan it

In `examples/book-club/app`:

```bash
npx wolfboy@0.1.1 scan
```

From a checkout of this repository, after the build steps in
[HOW-IT-WORKS.md](../../HOW-IT-WORKS.md#build-from-source-and-try-it), at its root:
`node product/packages/cli/dist/index.js scan --bundle dist/bundle --target examples/book-club/app`.

This is step 1: it runs on your machine in a few seconds, with no AI, and lists the places worth a
look. Step 2, the AI review in Claude Code, reads each place and reports the ones it judges to be
problems, with your code quoted and the law cited. The scan reads only `app/`, so this page is not part of what it judges. See
what it finds, then compare with the list below.

## The planted problems (this section gives the answers away)

1. Google Analytics and the Meta Pixel load on every page view, before the visitor has agreed to
   anything, while the privacy policy says the site uses only the cookies it needs to work
   (`app/public/index.html`).
2. Sign-up sends an MD5 hash of the member's e-mail address to Gravatar for an avatar. The hash
   still identifies the person (`app/src/avatar.ts`).
3. Sign-up writes the password, with the rest of the form, to the application log
   (`app/src/signup.ts`).
4. "Delete my account" only marks the member as closed and answers `deleted: true`. Name and e-mail
   address stay in the database for good, although the privacy policy promises deletion within 30
   days (`app/src/account.ts`).
5. The privacy policy says "We never share your e-mail address with advertisers", yet after
   sign-up the page passes the e-mail address to the Meta Pixel (`app/public/app.js`).
6. The "Ask the club" box sends a member's question to an AI model, and nothing tells the member
   that the answer comes from an AI (`app/public/index.html`, `app/src/assistant.ts`).
7. Each question goes to OpenAI with the member's name, and nothing in the app's documents tells a
   club that the name goes with it (`app/src/assistant.ts`, `app/INSTALL.md`).
8. The app's documents give no way to report a security vulnerability in it, and no policy for
   handling one (`app/INSTALL.md`; the scan points at `app/Dockerfile`). Under the EU's Cyber
   Resilience Act, both are required for copies sold from 11 December 2027. Separately, since
   11 September 2026 the maker has had to report any actively exploited vulnerability in the app to
   the authorities (its national CSIRT and ENISA), also for copies sold before then.
9. The app's documents do not say until when it will get security updates (`app/INSTALL.md`; the
   scan points at `app/Dockerfile`). Under the same Act, this is required for copies sold from
   11 December 2027.

## A sample report

[sample-report/report.md](sample-report/report.md) is WolfBoy 0.1.1's own report on this app, made on 19 November
2026 in Claude Code with the plugin: the ordinary review, without the second check, in about 2.9 million tokens and 4
minutes of review. The record for your team is beside it,
in [sample-report/record/](sample-report/record/record.md).
The only changes to either are these: paths to WolfBoy's own files are shortened (`<wolfboy>/...`), and links into the
app's code point at `app/` from this folder. Their rough edges are listed in [KNOWN-ISSUES.md](../../KNOWN-ISSUES.md).
