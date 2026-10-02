-- AGITAR Canvas — esquema de dados
--
-- Estrutura:
--   profiles          dados públicos mínimos de cada usuário autenticado
--   projects          projetos (planejamentos) e seus dados descritivos
--   project_members   quem acessa cada projeto e com qual papel
--   notes             notas do canvas, uma linha por nota, com versão
--   project_events    histórico de alterações (quem, quando, o quê)
--   project_versions  fotografias do canvas para restauração
--   project_invites   convites por email ainda não aceitos
--   project_links     links de acesso controlado
--
-- As regras de acesso estão em 0003_policies.sql. Nenhuma tabela é legível
-- sem autenticação.

create schema if not exists private;

create type public.project_role as enum ('owner', 'editor', 'viewer');
create type public.project_status as enum ('draft', 'active', 'done');

-- ---------------------------------------------------------------------------
-- Metodologia
-- ---------------------------------------------------------------------------

-- Limite de notas por bloco do canvas. Retorna null para blocos inexistentes,
-- o que permite usar a função também como validação do identificador.
-- Deve permanecer igual a src/methodology/agitar.ts.
create function public.agitar_block_limit(p_block text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_block
    when 'planejamento' then 6
    when 'problema' then 2
    when 'mercado' then 2
    when 'geracao' then 5
    when 'selecionadas' then 5
    when 'financeiros' then 5
    when 'tecnicos' then 5
    when 'parceiros' then 5
    when 'resultados' then 6
  end
$$;

-- Lista de participantes: sem itens nulos e com tamanho limitado por item.
create function public.agitar_valid_participants(p_items text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(cardinality(p_items), 0) <= 50
    and not exists (
      select 1 from unnest(p_items) as item
      where item is null or char_length(item) = 0 or char_length(item) > 160
    )
$$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 160),
  email text not null default '',
  -- Carregada pelo navegador dos colegas de projeto: somente endereços https.
  avatar_url text check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 2048)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_email_idx on public.profiles (lower(email));

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  organization text not null default '' check (char_length(organization) <= 160),
  responsible text not null default '' check (char_length(responsible) <= 160),
  participants text[] not null default '{}' check (public.agitar_valid_participants(participants)),
  status public.project_status not null default 'draft',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create index projects_owner_idx on public.projects (owner_id);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.project_role not null,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members (user_id);

-- Cada projeto tem exatamente um proprietário.
create unique index project_members_one_owner_idx
  on public.project_members (project_id)
  where role = 'owner';

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  block text not null check (public.agitar_block_limit(block) is not null),
  content text not null default '' check (char_length(content) <= 2000),
  position double precision not null default 0 check (position between -1e12 and 1e12),
  -- Incrementada a cada gravação. O cliente envia a versão que conhece e a
  -- gravação só é aceita se ela ainda for a atual (controle de concorrência).
  version integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exclusão lógica: permite desfazer, restaurar versões e propagar a
  -- exclusão em tempo real respeitando as regras de acesso.
  deleted_at timestamptz
);

create index notes_project_active_idx on public.notes (project_id, block) where deleted_at is null;

create table public.project_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  -- Nome registrado no momento do evento, para que o histórico continue
  -- legível depois que a pessoa deixar o projeto.
  actor_name text not null default '',
  at timestamptz not null default now(),
  kind text not null,
  block text,
  note_id uuid,
  before jsonb,
  after jsonb
);

create index project_events_project_idx on public.project_events (project_id, id desc);
create index project_events_note_idx on public.project_events (note_id, id desc) where note_id is not null;

create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 160),
  kind text not null check (kind in ('manual', 'auto', 'restore')),
  note_count integer not null default 0,
  snapshot jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);

create index project_versions_project_idx on public.project_versions (project_id, created_at desc);

create table public.project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%._%'),
  role public.project_role not null check (role <> 'owner'),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, email)
);

create index project_invites_email_idx on public.project_invites (email);

create table public.project_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- 244 bits aleatórios; o link só funciona para quem estiver autenticado.
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  role public.project_role not null check (role <> 'owner'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create index project_links_project_idx on public.project_links (project_id);
