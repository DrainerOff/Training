# Published releases (regression fixtures)

`ea0febc/` is the app exactly as GitHub Pages served it for build `ea0febc` (the first
public release): `git archive ea0febc app`, with `__BUILD__` stamped like CI does. Fonts and
icons are left out; the test server takes them from `app/`.

`tests/e2e/update.spec.js` installs this release, records data in it, then publishes the
current code over it and checks that the update keeps the IndexedDB data, does not repeat the
one-time import and starts offline. Don't edit these files: they stand for what is already on
users' phones.
