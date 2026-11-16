# Sign-in company that may receive data · ruled out 1 time

- [report](../report.md) · [all ruled out](../ruled-out.md)
- Rule `recipients-004`: Identity or access vendor named in the tree -
  candidate recipient for the record of processing activities

- [public/index\.html:20](../../app/public/index.html#L20)\
  [8cf648](#verdict-8cf648) · Q1: the matched line (public/index\.html:20)
  is a script tag the visitor's browser loads from connect\.facebook\.net.

### Verdict 8cf648

- recipients-004 `fp_8cf648724585f6de`: not applicable — Q1: the matched
  line (public/index\.html:20) is a script tag the visitor's browser loads
  from connect\.facebook\.net. Shape (c) in form, but the file is
  \`fbevents\.js\`, Meta's advertising event pixel, which is queued through
  \`window\.fbq\` (index\.html:17-18). It is not Facebook Login or any
  sign-in SDK. …
  - Places: 1 of 1 place read: 1 by opening the lines around the match, 0
    from the matched line alone (a prose line or catalogue entry the
    program checked holds no code; not opened); 0 not checked.
    - `public/index.html`: line 20 read by opening the lines around the
      match
  - 0 places were decided with a line outside the lines around the match,
    which the review opened.
  - Items: none named.
  - Every place, with how it was decided:
    `.legal/evidence/places/fp_8cf648724585f6de.places.jsonl` (one row per
    place; the row of place P\<n> is line n + 2).
