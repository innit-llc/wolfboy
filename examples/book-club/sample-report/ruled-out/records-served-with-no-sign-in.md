# Records served with no sign-in found, unlike nearby routes · judged not a problem 1 time

- [report](../report.md) · [all judged not a problem](../ruled-out.md)
- Check `exposure-surface-004`: Records served with no sign-in found,
  unlike nearby routes

- [`src/server.ts:8`](../../app/src/server.ts#L8)\
  [cd164c](#finding-cd164c) · The matched line only builds the path of the
  public/ folder, which line 12 of the same file serves as static files
  (index\.html, app\.js, style\.css).

### Finding cd164c

- exposure-surface-004 `fp_cd164ca8d5953376`: judged not a problem — The
  matched line only builds the path of the public/ folder, which line 12 of
  the same file serves as static files (index\.html, app\.js, style\.css).
  That is the site's own page and script, not a route over members'
  records. I read src/server\.ts in full: it registers no GET route that
  returns member records. …
  - Places: 1 of 1 place read, by opening the lines around the match.
    - `src/server.ts`: line 8 read by opening the lines around the match
  - 0 places were decided with a line outside the lines around the match,
    which the review opened.
  - Every place, with how it was decided:
    `.legal/evidence/places/fp_cd164ca8d5953376.places.jsonl` (after a
    first line about the finding, then one line for each place).
