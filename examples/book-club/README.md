# Example Book Club: a demo to scan

A very small sign-up app (in `app/`), written for this repository, with a few compliance problems planted on
purpose. Scan it to see what the scanner reports before you point it at your own code. Every person,
address and company in it is made up; the analytics, ad and avatar services it calls are real ones, so that the scan
can recognise them.

## Scan it

In `examples/book-club/app`:

```bash
npx wolfboy@0.1.0 scan
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

## A sample report

[sample-report/report.md](sample-report/report.md) is WolfBoy 0.1.0's own report on this app, made on 15 November 2026
in Claude Code with the plugin: the ordinary review, without the second check, in about 1.9 million tokens and 5
minutes of review. The record for your team is beside it, in [sample-report/record/](sample-report/record/record.md).
The only changes to either are these: paths to WolfBoy's own files are shortened (`<wolfboy>/...`), and links into the
app's code point at `app/` from this folder. Their rough edges are listed in [KNOWN-ISSUES.md](../../KNOWN-ISSUES.md).
