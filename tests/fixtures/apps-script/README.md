# Deployed Apps Script versions (regression fixtures)

`Code.api1.gs` — `apps-script/Code.gs` as deployed before manual personal records (API 1,
build 3da1b4a and earlier). `tests/server/records-sync.test.js` runs the current app against it
to make sure records are never treated as saved by a server that doesn't know them, and reach
the sheet once the owner updates Code.gs. Don't edit: it stands for what is deployed today.

`Code.api2.gs` — `apps-script/Code.gs` of v1.0.0 (API 2, with `App_Records`, without
`App_Exercises`). The owner's script runs this version until they update to API 3;
`tests/server/exercises-sync.test.js` checks that exercise settings wait on the phone until then.

`Code.api3.gs` — `apps-script/Code.gs` of v1.0.2 (API 3, with `App_Exercises`, without
`App_Body` / `App_Sleep`). `tests/server/body-sync.test.js` checks that measurements and sleep
wait on the phone until the owner updates to API 4.
