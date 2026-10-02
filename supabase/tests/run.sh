#!/usr/bin/env bash
# Aplica as migrações em um banco descartável e executa os testes de acesso.
#
# Uso:
#   TEST_DATABASE_URL=postgres://usuario:senha@host:5432/postgres npm run test:db
#
# O usuário informado precisa poder criar bancos e papéis. Sem a variável, o
# script tenta iniciar um servidor Postgres temporário com os binários locais.
set -euo pipefail

cd "$(dirname "$0")/../.."
DB="agitar_test_$$"
TMP=""

cleanup() {
  if [ -n "${ADMIN_URL:-}" ]; then
    psql "$ADMIN_URL" -q -c "drop database if exists $DB" >/dev/null 2>&1 || true
  fi
  if [ -n "$TMP" ]; then
    "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  ADMIN_URL="$TEST_DATABASE_URL"
else
  PGBIN="$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | tail -1)")"
  if [ ! -x "$PGBIN/initdb" ]; then
    echo "Defina TEST_DATABASE_URL ou instale o Postgres para rodar os testes do banco." >&2
    exit 1
  fi
  if [ "$(id -u)" = "0" ]; then
    echo "O Postgres não inicia como root. Rode como usuário comum ou defina TEST_DATABASE_URL." >&2
    exit 1
  fi
  TMP="$(mktemp -d)"
  "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
  "$PGBIN/pg_ctl" -D "$TMP/data" -o "-c listen_addresses='' -k $TMP" -w start >/dev/null
  ADMIN_URL="postgresql://postgres@/postgres?host=$TMP"
fi

psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "create database $DB"
TEST_URL="$(printf '%s' "$ADMIN_URL" | sed -E "s#/[^/?]+(\?|\$)#/$DB\1#")"

run() { psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$1"; }

run supabase/tests/00_supabase_stub.sql
for migration in supabase/migrations/*.sql; do
  run "$migration"
done
run supabase/tests/access.test.sql
