#!/usr/bin/env bash
# Builds a disposable local database with the complete Ritnome live migration chain. Usage: apply-local.sh <dbname>
set -euo pipefail
DB=${1:-ritlocal}; here=$(cd "$(dirname "$0")/.." && pwd); tmp=$(mktemp)
psql -qc "drop database if exists $DB" postgres; psql -qc "create database $DB" postgres
for f in test/local-auth-stub ritnome-dedicated-live-bootstrap ritnome-storage-candidate ritnome-transaction-candidate ritnome-membership-candidate ritnome-reversal-candidate ritnome-atomic-access-candidate ritnome-enrollment-candidate ritnome-enrollment-access-hold-candidate ritnome-live-enrollment-extension ritnome-live-readiness ritnome-reporting-foundation; do
  grep -vE "^(BEGIN;|COMMIT;)\s*$" "$here/$f.sql" > "$tmp"; psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$tmp" >/dev/null
done
rm -f "$tmp"; echo "$DB ready"
