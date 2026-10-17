# Filter-list snapshot (content blockers)

Rules from EasyList, EasyPrivacy, Fanboy's lists and the AdGuard filters (the lists behind
Safari content blockers such as AdGuard, 1Blocker, Wipr and AdBlock Pro), reduced to what can
apply to the app on `draineroff.github.io` and to the sync API on `script.google.com`:

* `network.txt.gz` — request rules (first-party generic rules + third-party rules for the API);
* `cosmetic.txt.gz` — element-hiding selectors (generic, or for github.io).

Used by `tests/unit/blockers.test.js` (file names) and `tests/e2e/blockers.spec.js` (a content
blocker emulated in Chromium; every screen checked for hidden elements).

Refresh: `npm run check:blockers -- --update` (downloads the lists, checks the app against them,
rewrites both files). CI runs the same check against the live lists on every push.
