# Coach Memory — release steps

Coach Memory keeps each coach's training plans and goals for verified athletes between sessions, inside Coach View (hooporia.mobi/coach.html → Athlete profile → Coach Memory) and the Goal Center. Athletes are never matched by name: License Admin enrolls each athlete with a roster label and decides which named coach may see which enrollment.

Three deployments and one SQL run. Production stays off until step 4 is done; until then the Coach Memory section shows "not activated yet" and everything else in Coach View works as before.

## 1. Supabase (once)
1. SQL Editor → run `coach-memory/release.sql` as a whole. The check at the end lists 9 tables and 13 functions.
2. Create the server login (new query, with a long random password you keep in Render only):
   `create role coach_memory_login login noinherit password '…'; grant coach_memory_backend to coach_memory_login;`
3. Authentication → Providers → Email: enabled, with "Confirm email" on. Coaches create their own account from Coach View; nothing else is needed for them.
4. Note the session-pooler connection string (Project settings → Database → Connection string → Session pooler, port 5432). Use `coach_memory_login` as the user. The direct host is IPv6-only, which Render cannot reach; the session pooler keeps the transaction behaviour the server relies on.

## 2. hooporia-server (Render service hooporia-server (hooporia-server.onrender.com))
Environment variables:
- `COACH_MEMORY_ENABLED=true`
- `COACH_MEMORY_SUPABASE_URL` = the project URL (https://….supabase.co)
- `COACH_MEMORY_PUBLISHABLE_KEY` = the project's anon (publishable) key
- `COACH_MEMORY_DATABASE_URL` = the session-pooler URL for `coach_memory_login`

Deploy `main` after the `feature/coach-memory-backend` branch is merged. The endpoint is `/v1/coach-memory`; it answers only to `https://hooporia.mobi`, with JSON up to 40 KB, and reads the coach's token through Supabase Auth on every request. Turning it off is `COACH_MEMORY_ENABLED=false` + redeploy; nothing is deleted.

## 3. hooporia.mobi and License Admin
- fortress-MOBI `main`: `coach.html` + `coach-memory.js` (built from `coach-memory/src` with `node coach-memory/build.cjs`).
- cognitivo-gym-ADMIN `main`: the Coach Memory tab.

## 4. First use
1. License Admin → Coach Memory → type the program name → Manage program.
2. Enroll athlete with a roster label (team · number).
3. The coach opens Coach View → Athlete profile → Coach Memory → Create account (email + password), confirms the email, then signs in.
4. License Admin → Coach Memory → that enrollment → type the coach's email → ＋ Coach.
5. In Coach View the coach picks the athlete profile, then the enrollment, saves a plan, adds goals in the Goal Center; both come back on the next sign-in on any device.

## What was verified
- Isolated SQL: payload allow-list, anonymous/forged/revoked/ended denial, idempotent saves, restricted roles, administrator operations (cross-admin and non-admin denied).
- The real server handler with the restricted pool and the real SQL: 17 checks, including revoke taking effect immediately and history kept after revoke/end.
- Browser, mobile and desktop, against that server: sign-in, enrollment list, plan save and history, goal save and restore through the Goal Center, profile switch clears the pairing, lock signs out, another coach cannot read or force another athlete's id.
- License Admin tab against the real admin SQL.
Not verified here: the hosted Supabase project itself (role creation and auth.* grants ran on a local Supabase stack in CI, not on production), and Render's connection to the session pooler. Both are checked in step 4; if the Coach Memory section says "not activated yet", the server-side environment is the place to look.
