# Records served with no sign-in found, unlike nearby routes · ruled out 1 time

- [report](../report.md) · [all ruled out](../ruled-out.md)
- Rule `exposure-surface-004`: Public route serving records with no
  credential in its declaration, of the kind that appears beside sibling
  routes whose credential is a secret path segment or a handler argument

- [src/server\.ts:7](../../app/src/server.ts#L7)\
  [cd164c](#verdict-cd164c) · Q6: the matched line (src/server\.ts:7) is a
  filesystem path constant, shape (v)/clause 1,2 spelling only
  (\`\.\./public\` pl

### Verdict cd164c

- exposure-surface-004 `fp_cd164ca8d5953376`: not applicable — Q6: the
  matched line (src/server\.ts:7) is a filesystem path constant, shape
  (v)/clause 1,2 spelling only (\`\.\./public\` plus \`new URL(\`). It is
  not a route registration, a credential-optional parameter, a person-named
  path parameter or a no-auth declaration. The routes in the window are
  app\.use(express\.static(publicDir)), app\.get("/privacy", \.\.\.) and
  two app\.use("/api", \.\.\.) …
  - Places: 1 of 1 place read: 1 by opening the lines around the match, 0
    from the matched line alone (a prose line or catalogue entry the
    program checked holds no code; not opened); 0 not checked.
    - `src/server.ts`: line 7 read by opening the lines around the match
  - 0 places were decided with a line outside the lines around the match,
    which the review opened.
  - Every place, with how it was decided:
    `.legal/evidence/places/fp_cd164ca8d5953376.places.jsonl` (one row per
    place; the row of place P\<n> is line n + 2).
