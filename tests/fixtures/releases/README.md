# Published releases (regression fixtures)

Each folder is the app exactly as GitHub Pages served it for that build (`git archive <sha> app`,
`__BUILD__` stamped like CI does). Fonts and icons are left out; the test server takes them
from `app/`.

* `ea0febc/` — the first public release: no boot.js, hangs on «Загрузка…» when IndexedDB stalls;
* `7705635/` — with boot.js, but `js/lib/analytics.js` is refused by Safari content blockers
  (EasyPrivacy `/lib/analytics.js`), so it doesn't start while blocking is on.

`tests/e2e/update.spec.js` and `tests/e2e/blockers.spec.js` install a release, record data in
it, then publish the current code over it and check that the update keeps the IndexedDB data,
does not repeat the one-time import and starts offline. Don't edit these files: they stand for what is already on
users' phones.
