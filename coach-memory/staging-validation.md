# Isolated Supabase staging validation

Decision: use an ephemeral local Supabase stack on a GitHub Actions runner, not the hosted production project. No hosted credentials, real athlete records or paid service required. The existing isolated PostgreSQL tests remain mandatory.

## Setup requirements
- Pin a supported Supabase CLI release and PostgreSQL driver with lockfile; verify runner Docker capacity.
- Initialize a fresh temporary Supabase directory with the CLI, start local services, and obtain local credentials only within the runner. Never link a hosted project.
- Apply the reviewed Coach Memory draft SQL in dependency order from the tested Fortress-MOBI commit c432489b37a3c012ae10583c290bf2ea395765c0. Do not apply synthetic auth bootstrap SQL to actual Supabase.
- Create fictional test accounts through local Auth admin API and authenticate through the real Auth endpoint. Do not print credentials, JWTs or session IDs.
- Provision a temporary dedicated login with only coach_memory_backend role membership; verify role grants and inherited PUBLIC permissions.
- Keep the production mount hard-disabled. Use a separate test-only service instance bound to loopback. Local Auth HTTP is permitted only in the isolated harness via a trusted test transport, not by weakening production HTTPS validation.
- Verify actual Auth token claims, valid coach save/read, unauthorized coach denial, anonymous and revoked sessions, repeated request idempotency, unverified BPM rejection and protected row write denial.
- Run database security advisors if supported by the selected local CLI. Destroy ephemeral containers and synthetic credentials at job completion.
- No production migrations, activation, deployment or hosted project creation without separate approval.

## Exit criteria
All actual Auth integration checks and restricted SQL tests pass, with no production access. Concurrent revocation and privacy review remain separate release gates.
