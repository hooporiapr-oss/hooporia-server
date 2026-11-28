# Ritnome institutional tests

- Unit suites: `node ritnome-<name>.test.js` (mock-based, no network).
- SQL suite: `security-review/test/apply-local.sh <db>` then `psql -d <db> -f security-review/test/reporting-foundation-tests.sql` (expects 0 FAIL).
- Service suite: `RITNOME_TEST_DATABASE_URL=... node ritnome-reporting.local.test.js` (real HTTP against the local db).
- Browser suite (release gate for activity integrations): `RITNOME_TEST_DATABASE_URL=... RITNOME_BPM_DIR=<ritnome-bpm checkout> node ritnome-institutional.browser.test.js` (Playwright).
- Trial rules (SQL, 7 checks): `psql -d <db> -f security-review/test/trial-tests.sql` on a freshly applied database.
- Progress suite (Phase 5: participant picker at the station, progress rows per handle, Individual Progress on the desk): `RITNOME_TEST_DATABASE_URL=... RITNOME_RV_DIR=... node ritnome-progress.browser.test.js`.
- R1 accuracy rules (SQL, 17 checks: facilitated session identity, Puerto Rico periods, plan history, overlap, estimates): `psql -d <db> -f security-review/test/r1-tests.sql` on a freshly applied database.
- Executive report suite (R2: real data via the service, narrative reconciles with totals, management-only utilization, one Letter page, role check, sample labeling): `RITNOME_TEST_DATABASE_URL=... node ritnome-report.browser.test.js`.
- Desk suite (Phase 3: sign-in, three tabs, launch, Facilitator/Management views, plan, staff, handles, inactivity lock): `RITNOME_TEST_DATABASE_URL=... node ritnome-desk.browser.test.js` on a freshly applied database (it leaves facility settings changed on purpose).
- Activity gate (Phase 4, one block per onboarded activity: athlete mode untouched, institutional run start/report/close, no athlete-database calls): `RITNOME_TEST_DATABASE_URL=... RITNOME_BPM_DIR=... RITNOME_RV_DIR=<reaction-velocity checkout> RITNOME_MOBI_DIR=<fortress-mobi checkout> node ritnome-activities.browser.test.js`.

Never point any suite at a hosted Supabase project.
