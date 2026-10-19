# Published releases (regression fixtures)

Each folder is the app exactly as GitHub Pages served it for that build (`git archive <sha> app`,
`__BUILD__` stamped like CI does). Fonts and icons are left out; the test server takes them
from `app/`.

* `ea0febc/` — the first public release: no boot.js, hangs on «Загрузка…» when IndexedDB stalls;
* `7705635/` — with boot.js, but `js/lib/analytics.js` is refused by Safari content blockers
  (EasyPrivacy `/lib/analytics.js`), so it doesn't start while blocking is on;
* `3f386f8/` — the build accepted on the owner's iPhone (records, IndexedDB version 2), published
  from the working branch; v1.0.0 is the same code published from `main`. Taken from `gh-pages`;
* `bf41b45/` — v1.0.2 from `main` (exercise settings, IndexedDB version 3): what the owner's
  iPhone runs before v1.1.0 (body measurements and sleep, IndexedDB version 4).

`tests/e2e/update.spec.js`, `blockers.spec.js`, `records.spec.js` and `release.spec.js` install a release, record data in
it, then publish the current code over it and check that the update keeps the IndexedDB data,
does not repeat the one-time import and starts offline. Don't edit these files: they stand for what is already on
users' phones.
