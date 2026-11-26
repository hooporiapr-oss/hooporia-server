# Coach Memory server installation (development only)
Do not install in production until the database permission tests, live Supabase auth staging tests and privacy review pass.
- Copy coach-memory-service.cjs, coach-memory-http.cjs and coach-memory-install.cjs into the server repository (not the static publish directory).
- Use a separately configured PostgreSQL pool with TLS certificate verification; pin and lock the driver dependency in the target repository. Do not reuse an administrator or service-role connection. The dedicated login may assume only coach_memory_backend; audit inherited PUBLIC privileges and existing database grants before use.
- Mount installCoachMemory(app,{pool}) before express.json() and global CORS, after confirming the exact route is unused.
- Configuration: COACH_MEMORY_ENABLED=false (default), COACH_MEMORY_SUPABASE_URL, COACH_MEMORY_PUBLISHABLE_KEY. Supply database connection credentials only through server secret storage, never in GitHub or browser. No real values included here.
- Before enabling: validate runtime permissions, concurrent revocation, verified identity/coach enrollment, pilot consent, rate limits, request timeout, logs without tokens or athlete records, and rollback procedure. Unverified BPM storage remains blocked.
- Disable immediately by switching COACH_MEMORY_ENABLED=false and redeploying the server. Do not drop athlete history.
- The current server repository is read-only to this integration (403); this is a preparation package only.
