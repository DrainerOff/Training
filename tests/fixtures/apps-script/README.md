# Deployed Apps Script versions (regression fixtures)

`Code.api1.gs` — `apps-script/Code.gs` as deployed before manual personal records (API 1,
build 3da1b4a and earlier). `tests/server/records-sync.test.js` runs the current app against it
to make sure records are never treated as saved by a server that doesn't know them, and reach
the sheet once the owner updates Code.gs. Don't edit: it stands for what is deployed today.
