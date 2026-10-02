-- AGITAR Canvas — funções auxiliares e gatilhos
--
-- As funções do esquema "private" não são expostas pela API. Elas são
-- SECURITY DEFINER para poder consultar as tabelas de associação sem
-- recursão nas políticas de acesso, e fixam search_path para evitar
-- sequestro de nomes.

-- ---------------------------------------------------------------------------
-- Papéis do usuário atual
-- ---------------------------------------------------------------------------

create function private.project_role(p_project uuid)
returns public.project_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.project_members m
  where m.project_id = p_project
    and m.user_id = (select auth.uid())
$$;

create function private.is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.project_role(p_project) is not null
$$;

create function private.can_edit(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.project_role(p_project) in ('owner', 'editor'), false)
$$;

create function private.is_owner(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.project_role(p_project) = 'owner', false)
$$;

-- Verdadeiro quando o usuário atual participa de algum projeto com a pessoa.
create function private.shares_project_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user
  )
$$;

create function private.current_user_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(p.full_name, '') from public.profiles p where p.id = (select auth.uid())),
    (select nullif(p.email, '') from public.profiles p where p.id = (select auth.uid())),
    ''
  )
$$;

-- Email confirmado do usuário atual, em minúsculas. Convites só são aceitos
-- para emails confirmados pelo provedor de identidade.
create function private.current_user_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email)
  from auth.users u
  where u.id = (select auth.uid())
    and u.email_confirmed_at is not null
$$;

-- Operações em lote (restauração, duplicação) desligam o registro detalhado
-- de eventos e gravam um único evento resumido.
create function private.events_suppressed()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('agitar.suppress_events', true), '') = 'on'
$$;

create function private.log_event(
  p_project uuid,
  p_kind text,
  p_block text default null,
  p_note uuid default null,
  p_before jsonb default null,
  p_after jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_events (project_id, actor_id, actor_name, kind, block, note_id, before, after)
  values (p_project, (select auth.uid()), private.current_user_name(), p_kind, p_block, p_note, p_before, p_after);
end
$$;

-- ---------------------------------------------------------------------------
-- Perfis: criados e sincronizados a partir de auth.users
-- ---------------------------------------------------------------------------

create function private.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
  v_avatar text := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'picture', '')
  );
begin
  -- Um endereço fora do padrão não pode impedir a criação da conta.
  if v_avatar is not null and (v_avatar !~ '^https://' or char_length(v_avatar) > 2048) then
    v_avatar := null;
  end if;

  insert into public.profiles (id, full_name, email, avatar_url)
  values (new.id, left(v_name, 160), lower(coalesce(new.email, '')), v_avatar)
  on conflict (id) do update
    set email = excluded.email,
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end,
        updated_at = now();
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_auth_user();

create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function private.handle_auth_user();

-- Contas criadas antes desta migração também recebem perfil.
insert into public.profiles (id, full_name, email, avatar_url)
select
  u.id,
  left(coalesce(
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(u.email, ''), '@', 1)
  ), 160),
  lower(coalesce(u.email, '')),
  case
    when coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') ~ '^https://'
     and char_length(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')) <= 2048
      then coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
  end
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Versões (fotografias do canvas)
-- ---------------------------------------------------------------------------

create function private.build_snapshot(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'project', (
      select jsonb_build_object(
        'name', p.name,
        'description', p.description,
        'organization', p.organization,
        'responsible', p.responsible,
        'participants', to_jsonb(p.participants),
        'status', p.status
      )
      from public.projects p
      where p.id = p_project
    ),
    'notes', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', n.id, 'block', n.block, 'content', n.content, 'position', n.position)
        order by n.block, n.position, n.created_at
      )
      from public.notes n
      where n.project_id = p_project
        and n.deleted_at is null
    ), '[]'::jsonb)
  )
$$;

create function private.insert_version(p_project uuid, p_label text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb := private.build_snapshot(p_project);
  v_id uuid;
begin
  insert into public.project_versions (project_id, label, kind, note_count, snapshot, created_by, created_by_name)
  values (
    p_project,
    p_label,
    p_kind,
    jsonb_array_length(v_snapshot -> 'notes'),
    v_snapshot,
    (select auth.uid()),
    private.current_user_name()
  )
  returning id into v_id;
  return v_id;
end
$$;

-- Garante uma versão automática por dia de trabalho: antes da primeira
-- alteração após 24 horas sem versões, o estado atual é guardado.
create function private.ensure_auto_version(p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.events_suppressed() then
    return;
  end if;

  -- O projeto pode ter sido excluído na mesma operação (exclusão em cascata).
  if not exists (select 1 from public.projects p where p.id = p_project) then
    return;
  end if;

  -- Projetos criados há menos de 24 horas ainda não têm estado anterior
  -- relevante para guardar.
  if exists (
    select 1 from public.projects p
    where p.id = p_project
      and p.created_at > now() - interval '24 hours'
  ) then
    return;
  end if;

  if exists (
    select 1 from public.project_versions v
    where v.project_id = p_project
      and v.created_at > now() - interval '24 hours'
  ) then
    return;
  end if;

  if not exists (
    select 1 from public.notes n
    where n.project_id = p_project and n.deleted_at is null
  ) then
    return;
  end if;

  -- Duas gravações simultâneas não criam duas versões automáticas.
  perform pg_advisory_xact_lock(hashtextextended('autoversion:' || p_project::text, 0));
  if exists (
    select 1 from public.project_versions v
    where v.project_id = p_project
      and v.created_at > now() - interval '24 hours'
  ) then
    return;
  end if;

  perform private.insert_version(p_project, 'Versão automática', 'auto');

  -- Mantém apenas as 30 versões automáticas mais recentes.
  delete from public.project_versions v
  where v.project_id = p_project
    and v.kind = 'auto'
    and v.id not in (
      select v2.id from public.project_versions v2
      where v2.project_id = p_project and v2.kind = 'auto'
      order by v2.created_at desc
      limit 30
    );
end
$$;

-- ---------------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------------

create function private.projects_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := btrim(new.name);

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.updated_by := (select auth.uid());
    return new;
  end if;

  if new.id <> old.id or new.owner_id <> old.owner_id then
    raise exception 'immutable_field' using errcode = '42501';
  end if;

  -- Arquivar e desarquivar é decisão do proprietário.
  if new.archived_at is distinct from old.archived_at and not private.is_owner(old.id) then
    raise exception 'owner_only' using errcode = '42501';
  end if;

  -- Projeto arquivado é somente leitura: só aceita ser desarquivado.
  if old.archived_at is not null and new.archived_at is not null then
    raise exception 'project_archived' using errcode = 'P0001';
  end if;

  new.created_at := old.created_at;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), old.updated_by);
  return new;
end
$$;

-- Os gatilhos listam as colunas de conteúdo. Atualizações internas (data de
-- atualização, anulação de referências quando um usuário é excluído) não os
-- disparam, o que mantém a exclusão de contas funcionando.
create trigger projects_before_write
  before insert or update of id, owner_id, name, description, organization, responsible, participants, status, archived_at
  on public.projects
  for each row execute function private.projects_before_write();

create function private.projects_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.project_members (project_id, user_id, role)
    values (new.id, new.owner_id, 'owner');

    if not private.events_suppressed() then
      perform private.log_event(new.id, 'project_created', null, null, null, jsonb_build_object('name', new.name));
    end if;
    return new;
  end if;

  if private.events_suppressed() then
    return new;
  end if;

  if new.archived_at is distinct from old.archived_at then
    perform private.log_event(
      new.id,
      case when new.archived_at is null then 'project_unarchived' else 'project_archived' end
    );
  end if;

  if new.name is distinct from old.name then
    v_before := v_before || jsonb_build_object('name', old.name);
    v_after := v_after || jsonb_build_object('name', new.name);
  end if;
  if new.description is distinct from old.description then
    v_before := v_before || jsonb_build_object('description', old.description);
    v_after := v_after || jsonb_build_object('description', new.description);
  end if;
  if new.organization is distinct from old.organization then
    v_before := v_before || jsonb_build_object('organization', old.organization);
    v_after := v_after || jsonb_build_object('organization', new.organization);
  end if;
  if new.responsible is distinct from old.responsible then
    v_before := v_before || jsonb_build_object('responsible', old.responsible);
    v_after := v_after || jsonb_build_object('responsible', new.responsible);
  end if;
  if new.participants is distinct from old.participants then
    v_before := v_before || jsonb_build_object('participants', to_jsonb(old.participants));
    v_after := v_after || jsonb_build_object('participants', to_jsonb(new.participants));
  end if;
  if new.status is distinct from old.status then
    v_before := v_before || jsonb_build_object('status', old.status);
    v_after := v_after || jsonb_build_object('status', new.status);
  end if;

  if v_after <> '{}'::jsonb then
    perform private.log_event(new.id, 'project_updated', null, null, v_before, v_after);
  end if;

  return new;
end
$$;

create trigger projects_after_write
  after insert or update of name, description, organization, responsible, participants, status, archived_at
  on public.projects
  for each row execute function private.projects_after_write();

-- ---------------------------------------------------------------------------
-- Notas
-- ---------------------------------------------------------------------------

create function private.notes_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if exists (select 1 from public.projects p where p.id = new.project_id and p.archived_at is not null) then
    raise exception 'project_archived' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    new.created_by := v_uid;
    new.updated_by := v_uid;
  else
    if new.id <> old.id or new.project_id <> old.project_id then
      raise exception 'immutable_field' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.version := old.version + 1;
    new.updated_at := now();
    new.updated_by := coalesce(v_uid, old.updated_by);
  end if;

  -- O limite do bloco é verificado quando a nota entra em um bloco: criação,
  -- mudança de bloco ou restauração de nota excluída. A trava evita que duas
  -- pessoas ultrapassem o limite ao mesmo tempo.
  if new.deleted_at is null
     and (tg_op = 'INSERT' or old.deleted_at is not null or old.block <> new.block) then
    perform pg_advisory_xact_lock(hashtextextended(new.project_id::text || ':' || new.block, 0));

    select count(*) into v_count
    from public.notes n
    where n.project_id = new.project_id
      and n.block = new.block
      and n.deleted_at is null
      and n.id <> new.id;

    if v_count >= public.agitar_block_limit(new.block) then
      raise exception 'block_full' using errcode = 'P0001', detail = new.block;
    end if;
  end if;

  perform private.ensure_auto_version(new.project_id);
  return new;
end
$$;

create trigger notes_before_write
  before insert or update of id, project_id, block, content, position, deleted_at
  on public.notes
  for each row execute function private.notes_before_write();

create function private.notes_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_last public.project_events;
begin
  update public.projects
  set updated_at = now(),
      updated_by = coalesce(v_uid, updated_by)
  where id = new.project_id;

  if private.events_suppressed() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform private.log_event(
      new.project_id, 'note_created', new.block, new.id,
      null, jsonb_build_object('content', new.content)
    );
    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    perform private.log_event(
      new.project_id, 'note_deleted', new.block, new.id,
      jsonb_build_object('content', old.content), null
    );
    return new;
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    perform private.log_event(
      new.project_id, 'note_restored', new.block, new.id,
      null, jsonb_build_object('content', new.content)
    );
    return new;
  end if;

  if old.block <> new.block then
    perform private.log_event(
      new.project_id, 'note_moved', new.block, new.id,
      jsonb_build_object('block', old.block), jsonb_build_object('block', new.block)
    );
  end if;

  if old.content is distinct from new.content then
    -- O salvamento automático grava várias vezes durante a digitação.
    -- Gravações seguidas da mesma pessoa na mesma nota são consolidadas em
    -- um único evento, preservando o conteúdo anterior à primeira delas.
    select e.* into v_last
    from public.project_events e
    where e.note_id = new.id
    order by e.id desc
    limit 1;

    if found
       and v_last.kind in ('note_created', 'note_updated')
       and v_last.actor_id is not distinct from v_uid
       and v_last.at > now() - interval '10 minutes' then
      update public.project_events
      set after = jsonb_build_object('content', new.content),
          at = now()
      where id = v_last.id;
    else
      perform private.log_event(
        new.project_id, 'note_updated', new.block, new.id,
        jsonb_build_object('content', old.content),
        jsonb_build_object('content', new.content)
      );
    end if;
  end if;

  return new;
end
$$;

create trigger notes_after_write
  after insert or update of block, content, position, deleted_at
  on public.notes
  for each row execute function private.notes_after_write();
