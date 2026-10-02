-- AGITAR Canvas — regras de acesso (Row Level Security)
--
-- Princípios:
--   1. Toda tabela tem RLS ativo. Sem política correspondente, o acesso é negado.
--   2. Usuários não autenticados (papel "anon") não têm privilégio algum.
--   3. Leitura exige participar do projeto. Escrita exige papel de editor ou
--      proprietário. Gestão de pessoas, links, arquivamento e exclusão são
--      exclusivas do proprietário.
--   4. Associações, convites, links, histórico e versões só são gravados por
--      funções do servidor (0004_rpc.sql) e gatilhos, nunca diretamente.

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.notes enable row level security;
alter table public.project_events enable row level security;
alter table public.project_versions enable row level security;
alter table public.project_invites enable row level security;
alter table public.project_links enable row level security;

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Objetos criados no futuro neste esquema não ficam abertos por padrão: cada
-- nova tabela ou função precisa conceder explicitamente o que for necessário.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
revoke all on all functions in schema public from public, anon;
revoke all on all functions in schema private from public, anon;
revoke all on schema private from public, anon;

grant usage on schema private to authenticated;
-- Os privilégios de execução das funções são concedidos ao final de 0004_rpc.sql.

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

grant select, delete on public.projects to authenticated;
grant insert (id, name, description, organization, responsible, participants, status)
  on public.projects to authenticated;
grant update (name, description, organization, responsible, participants, status, archived_at)
  on public.projects to authenticated;

grant select on public.project_members to authenticated;

grant select on public.notes to authenticated;
grant insert (id, project_id, block, content, position) on public.notes to authenticated;
grant update (block, content, position, deleted_at) on public.notes to authenticated;

grant select on public.project_events to authenticated;
grant select on public.project_versions to authenticated;
grant select on public.project_invites to authenticated;
grant select on public.project_links to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create policy "perfil: leitura do proprio e de colegas de projeto"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_project_with(id));

create policy "perfil: atualizacao do proprio"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

-- A comparação com owner_id permite que a linha recém-criada seja devolvida
-- ao cliente antes de o gatilho registrar a associação de proprietário.
create policy "projeto: leitura por participantes"
  on public.projects for select to authenticated
  using (owner_id = (select auth.uid()) or private.is_member(id));

create policy "projeto: criacao em nome proprio"
  on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "projeto: edicao por editores"
  on public.projects for update to authenticated
  using (private.can_edit(id))
  with check (private.can_edit(id));

create policy "projeto: exclusao pelo proprietario"
  on public.projects for delete to authenticated
  using (private.is_owner(id));

-- ---------------------------------------------------------------------------
-- project_members (gravação somente por funções do servidor)
-- ---------------------------------------------------------------------------

create policy "membros: leitura por participantes"
  on public.project_members for select to authenticated
  using (private.is_member(project_id));

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------

create policy "notas: leitura por participantes"
  on public.notes for select to authenticated
  using (private.is_member(project_id));

create policy "notas: criacao por editores"
  on public.notes for insert to authenticated
  with check (private.can_edit(project_id));

create policy "notas: edicao por editores"
  on public.notes for update to authenticated
  using (private.can_edit(project_id))
  with check (private.can_edit(project_id));

-- ---------------------------------------------------------------------------
-- Histórico e versões (somente leitura para participantes)
-- ---------------------------------------------------------------------------

create policy "historico: leitura por participantes"
  on public.project_events for select to authenticated
  using (private.is_member(project_id));

create policy "versoes: leitura por participantes"
  on public.project_versions for select to authenticated
  using (private.is_member(project_id));

-- ---------------------------------------------------------------------------
-- Convites e links
-- ---------------------------------------------------------------------------

create policy "convites: leitura pelo proprietario e pelo convidado"
  on public.project_invites for select to authenticated
  using (private.is_owner(project_id) or email = private.current_user_email());

create policy "links: leitura pelo proprietario"
  on public.project_links for select to authenticated
  using (private.is_owner(project_id));
