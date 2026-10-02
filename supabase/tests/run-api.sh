#!/usr/bin/env bash
# Testa o repositório do modo nuvem contra uma API real: Postgres com as
# migrações aplicadas e PostgREST na frente, como no Supabase. Cobre consultas,
# relacionamentos, funções do servidor e regras de acesso vistas pelo cliente.
#
# Requisitos: binário "postgrest" no PATH (ou em POSTGREST_BIN) e Postgres
# local, ou TEST_DATABASE_URL apontando para um servidor com privilégio de
# criar bancos e papéis.
set -euo pipefail

cd "$(dirname "$0")/../.."
POSTGREST="${POSTGREST_BIN:-$(command -v postgrest || true)}"
if [ -z "$POSTGREST" ]; then
  echo "Instale o PostgREST (https://postgrest.org) ou defina POSTGREST_BIN." >&2
  exit 1
fi

DB="agitar_api_$$"
TMP="$(mktemp -d)"
OWN_CLUSTER=""
JWT_SECRET="segredo-de-teste-com-pelo-menos-32-caracteres"
API_PORT="${API_PORT:-3791}"

cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" >/dev/null 2>&1 || true
  if [ -n "${ADMIN_URL:-}" ]; then
    psql "$ADMIN_URL" -q -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true
  fi
  if [ -n "$OWN_CLUSTER" ]; then
    "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  ADMIN_URL="$TEST_DATABASE_URL"
else
  PGBIN="$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | tail -1)")"
  if [ "$(id -u)" = "0" ]; then
    echo "O Postgres não inicia como root. Rode como usuário comum ou defina TEST_DATABASE_URL." >&2
    exit 1
  fi
  "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
  "$PGBIN/pg_ctl" -D "$TMP/data" -o "-c listen_addresses='' -k $TMP" -w start >/dev/null
  OWN_CLUSTER=1
  ADMIN_URL="postgresql://postgres@/postgres?host=$TMP"
fi

psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "create database $DB"
TEST_URL="$(printf '%s' "$ADMIN_URL" | sed -E "s#/[^/?]+(\?|\$)#/$DB\1#")"
run() { psql "$TEST_URL" -q -v ON_ERROR_STOP=1 "$@"; }

run -f supabase/tests/00_supabase_stub.sql
for migration in supabase/migrations/*.sql; do
  run -f "$migration"
done

# Usuários de teste (os identificadores são usados em SupabaseRepository.integration.test.ts).
run <<'SQL'
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@exemplo.com', now(), '{"full_name": "Ana Proprietária"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bruno@exemplo.com', now(), '{"full_name": "Bruno Colaborador"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@exemplo.com', now(), '{"full_name": "Carla Convidada"}');
SQL

cat > "$TMP/postgrest.conf" <<CONF
db-uri = "$TEST_URL"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-port = $API_PORT
server-host = "127.0.0.1"
log-level = "crit"
CONF

"$POSTGREST" "$TMP/postgrest.conf" &
API_PID=$!

for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:$API_PORT/"; then break; fi
  sleep 0.1
done

API_TEST_URL="http://127.0.0.1:$API_PORT" API_TEST_JWT_SECRET="$JWT_SECRET" \
  npx vitest run src/data/supabase/SupabaseRepository.integration.test.ts
