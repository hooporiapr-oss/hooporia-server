# Ritnome institutional tests

- Unit suites: `node ritnome-<name>.test.js` (mock-based, no network).
- SQL suite: `security-review/test/apply-local.sh <db>` then `psql -d <db> -f security-review/test/reporting-foundation-tests.sql` (expects 0 FAIL).
- Service suite: `RITNOME_TEST_DATABASE_URL=... node ritnome-reporting.local.test.js` (real HTTP against the local db).
- Browser suite (release gate for activity integrations): `RITNOME_TEST_DATABASE_URL=... RITNOME_BPM_DIR=<ritnome-bpm checkout> node ritnome-institutional.browser.test.js` (Playwright).
- Desk suite (Phase 3: sign-in, three tabs, launch, Facilitator/Management views, plan, staff, handles, inactivity lock): `RITNOME_TEST_DATABASE_URL=... node ritnome-desk.browser.test.js` on a freshly applied database (it leaves facility settings changed on purpose).
- Activity gate (Phase 4, one block per onboarded activity: athlete mode untouched, institutional run start/report/close, no athlete-database calls): `RITNOME_TEST_DATABASE_URL=... RITNOME_BPM_DIR=... RITNOME_RV_DIR=<reaction-velocity checkout> RITNOME_MOBI_DIR=<fortress-mobi checkout> node ritnome-activities.browser.test.js`.

Never point any suite at a hosted Supabase project.
