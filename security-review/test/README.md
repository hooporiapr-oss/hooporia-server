# Ritnome institutional tests

- Unit suites: `node ritnome-<name>.test.js` (mock-based, no network).
- SQL suite: `security-review/test/apply-local.sh <db>` then `psql -d <db> -f security-review/test/reporting-foundation-tests.sql` (expects 0 FAIL).
- Service suite: `RITNOME_TEST_DATABASE_URL=... node ritnome-reporting.local.test.js` (real HTTP against the local db).
- Browser suite (release gate for activity integrations): `RITNOME_TEST_DATABASE_URL=... RITNOME_BPM_DIR=<ritnome-bpm checkout> node ritnome-institutional.browser.test.js` (Playwright).

Never point any suite at a hosted Supabase project.
