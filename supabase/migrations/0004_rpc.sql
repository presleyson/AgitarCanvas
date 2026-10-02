-- AGITAR Canvas — operações do servidor (RPC)
--
-- Cada função valida o papel do usuário atual antes de agir. Erros usam
-- mensagens curtas e estáveis, que o cliente traduz para a interface:
--   forbidden, not_found, invalid_email, invalid_role, invalid_link,
--   invalid_label, invalid_expiration, owner_cannot_leave, project_archived,
--   version_limit, block_full

create function private.require(p_condition boolean, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not coalesce(p_condition, false) then
    raise exception '%', p_message using errcode = case p_message
      when 'forbidden' then '42501'
      else 'P0001'
    end;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Pessoas e papéis
-- ---------------------------------------------------------------------------

-- Convida por email. O convite fica pendente até que a pessoa convidada o
-- aceite: ninguém é incluído em um projeto sem ação própria. A resposta não
-- revela se o email pertence a uma conta existente.
create function public.invite_member(p_project uuid, p_email text, p_role public.project_role)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  perform private.require(private.is_owner(p_project), 'forbidden');
  perform private.require(p_role in ('editor', 'viewer'), 'invalid_role');
  perform private.require(v_email like '%_@_%._%' and position(' ' in v_email) = 0, 'invalid_email');

  -- Consulta restrita a quem já participa deste projeto.
  if exists (
    select 1
    from public.project_members m
    join public.profiles p on p.id = m.user_id
    where m.project_id = p_project and lower(p.email) = v_email
  ) then
    return 'already_member';
  end if;

  perform private.require(
    (select count(*) from public.project_invites i where i.project_id = p_project) < 100,
    'invite_limit'
  );

  insert into public.project_invites (project_id, email, role, invited_by)
  values (p_project, v_email, p_role, (select auth.uid()))
  on conflict (project_id, email) do update set role = excluded.role;

  return 'invited';
end
$$;

create function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
begin
  select i.project_id into v_project from public.project_invites i where i.id = p_invite;
  perform private.require(v_project is not null and private.is_owner(v_project), 'forbidden');
  delete from public.project_invites where id = p_invite;
end
$$;

-- Convites pendentes para o email confirmado do usuário atual, com o mínimo
-- necessário para decidir: nome do projeto e de quem convidou.
create function public.my_invites()
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  role public.project_role,
  invited_by_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.project_id, p.name, i.role, coalesce(nullif(inviter.full_name, ''), ''), i.created_at
  from public.project_invites i
  join public.projects p on p.id = i.project_id
  left join public.profiles inviter on inviter.id = i.invited_by
  where i.email = private.current_user_email()
  order by i.created_at desc
$$;

-- Aceita um convite destinado ao email confirmado do usuário atual. Quem já
-- participa com papel menor recebe o papel do convite; nunca há rebaixamento.
create function public.accept_invite(p_invite uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := private.current_user_email();
  v_invite public.project_invites;
  v_current public.project_role;
begin
  select i.* into v_invite from public.project_invites i where i.id = p_invite;
  perform private.require(
    v_uid is not null and v_email is not null and v_invite.id is not null and v_invite.email = v_email,
    'not_found'
  );

  select m.role into v_current from public.project_members m
  where m.project_id = v_invite.project_id and m.user_id = v_uid;

  if v_current is null then
    insert into public.project_members (project_id, user_id, role, invited_by)
    values (v_invite.project_id, v_uid, v_invite.role, v_invite.invited_by);

    perform private.log_event(v_invite.project_id, 'member_added', null, null, null,
      jsonb_build_object('role', v_invite.role, 'via', 'invite'));
  elsif v_current = 'viewer' and v_invite.role = 'editor' then
    update public.project_members set role = 'editor'
    where project_id = v_invite.project_id and user_id = v_uid;

    perform private.log_event(v_invite.project_id, 'member_role_changed', null, null,
      jsonb_build_object('user_id', v_uid, 'role', v_current),
      jsonb_build_object('user_id', v_uid, 'role', 'editor', 'name', private.current_user_name()));
  end if;

  delete from public.project_invites where id = v_invite.id;
  return v_invite.project_id;
end
$$;

create function public.decline_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := private.current_user_email();
begin
  delete from public.project_invites i
  where i.id = p_invite and v_email is not null and i.email = v_email;
  perform private.require(found, 'not_found');
end
$$;

create function public.set_member_role(p_project uuid, p_user uuid, p_role public.project_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.project_role;
begin
  perform private.require(private.is_owner(p_project), 'forbidden');
  perform private.require(p_role in ('editor', 'viewer'), 'invalid_role');

  select m.role into v_old from public.project_members m
  where m.project_id = p_project and m.user_id = p_user;

  perform private.require(v_old is not null, 'not_found');
  perform private.require(v_old <> 'owner', 'forbidden');

  if v_old = p_role then
    return;
  end if;

  update public.project_members set role = p_role
  where project_id = p_project and user_id = p_user;

  perform private.log_event(p_project, 'member_role_changed', null, null,
    jsonb_build_object('user_id', p_user, 'role', v_old),
    jsonb_build_object('user_id', p_user, 'role', p_role,
      'name', (select full_name from public.profiles where id = p_user)));
end
$$;

create function public.remove_member(p_project uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.project_role;
begin
  perform private.require(private.is_owner(p_project), 'forbidden');

  select m.role into v_old from public.project_members m
  where m.project_id = p_project and m.user_id = p_user;

  perform private.require(v_old is not null, 'not_found');
  perform private.require(v_old <> 'owner', 'forbidden');

  delete from public.project_members where project_id = p_project and user_id = p_user;

  perform private.log_event(p_project, 'member_removed', null, null,
    jsonb_build_object('user_id', p_user, 'role', v_old,
      'name', (select full_name from public.profiles where id = p_user)), null);
end
$$;

create function public.leave_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.project_role := private.project_role(p_project);
begin
  perform private.require(v_role is not null, 'not_found');
  perform private.require(v_role <> 'owner', 'owner_cannot_leave');

  perform private.log_event(p_project, 'member_removed', null, null,
    jsonb_build_object('user_id', (select auth.uid()), 'role', v_role,
      'name', private.current_user_name(), 'left', true), null);

  delete from public.project_members
  where project_id = p_project and user_id = (select auth.uid());
end
$$;

-- ---------------------------------------------------------------------------
-- Links de acesso controlado
-- ---------------------------------------------------------------------------

create function public.create_link(p_project uuid, p_role public.project_role, p_expires_in_days integer default null)
returns public.project_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.project_links;
begin
  perform private.require(private.is_owner(p_project), 'forbidden');
  perform private.require(p_role in ('editor', 'viewer'), 'invalid_role');
  perform private.require(p_expires_in_days is null or p_expires_in_days between 1 and 365, 'invalid_expiration');

  insert into public.project_links (project_id, role, created_by, expires_at)
  values (
    p_project,
    p_role,
    (select auth.uid()),
    case when p_expires_in_days is null then null else now() + make_interval(days => p_expires_in_days) end
  )
  returning * into v_link;

  return v_link;
end
$$;

create function public.revoke_link(p_link uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
begin
  select l.project_id into v_project from public.project_links l where l.id = p_link;
  perform private.require(v_project is not null and private.is_owner(v_project), 'forbidden');
  update public.project_links set revoked_at = now() where id = p_link and revoked_at is null;
end
$$;

-- Entra no projeto usando um link válido. Quem já participa mantém o papel
-- que tem. Retorna o identificador do projeto.
create function public.join_via_link(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_link public.project_links;
begin
  perform private.require(v_uid is not null, 'forbidden');

  select l.* into v_link
  from public.project_links l
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now());

  perform private.require(v_link.id is not null, 'invalid_link');

  insert into public.project_members (project_id, user_id, role, invited_by)
  values (v_link.project_id, v_uid, v_link.role, v_link.created_by)
  on conflict (project_id, user_id) do nothing;

  if found then
    perform private.log_event(v_link.project_id, 'member_added', null, null, null,
      jsonb_build_object('role', v_link.role, 'via', 'link'));
  end if;

  return v_link.project_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Versões
-- ---------------------------------------------------------------------------

create function public.create_version(p_project uuid, p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_id uuid;
begin
  perform private.require(private.can_edit(p_project), 'forbidden');
  perform private.require(char_length(v_label) between 1 and 160, 'invalid_label');
  perform private.require(
    not exists (select 1 from public.projects p where p.id = p_project and p.archived_at is not null),
    'project_archived'
  );
  perform private.require(
    (select count(*) from public.project_versions v where v.project_id = p_project and v.kind = 'manual') < 200,
    'version_limit'
  );

  v_id := private.insert_version(p_project, v_label, 'manual');
  perform private.log_event(p_project, 'version_created', null, null, null,
    jsonb_build_object('label', v_label));
  return v_id;
end
$$;

-- Restaura as notas do canvas para o estado de uma versão. O estado atual é
-- guardado antes, de modo que a restauração também pode ser desfeita.
create function public.restore_version(p_version uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.project_versions;
  v_note jsonb;
begin
  select v.* into v_version from public.project_versions v where v.id = p_version;
  perform private.require(v_version.id is not null and private.can_edit(v_version.project_id), 'forbidden');
  perform private.require(
    not exists (select 1 from public.projects p where p.id = v_version.project_id and p.archived_at is not null),
    'project_archived'
  );

  -- Serializa restaurações concorrentes no mesmo projeto.
  perform pg_advisory_xact_lock(hashtextextended('restore:' || v_version.project_id::text, 0));

  perform private.insert_version(
    v_version.project_id,
    left('Antes de restaurar "' || v_version.label || '"', 160),
    'restore'
  );

  -- Mantém apenas as 30 cópias de segurança de restauração mais recentes.
  delete from public.project_versions v
  where v.project_id = v_version.project_id
    and v.kind = 'restore'
    and v.id not in (
      select v2.id from public.project_versions v2
      where v2.project_id = v_version.project_id and v2.kind = 'restore'
      order by v2.created_at desc, v2.id
      limit 30
    );

  perform set_config('agitar.suppress_events', 'on', true);

  update public.notes
  set deleted_at = now()
  where project_id = v_version.project_id and deleted_at is null;

  for v_note in select * from jsonb_array_elements(v_version.snapshot -> 'notes')
  loop
    insert into public.notes (id, project_id, block, content, position)
    values (
      -- Um identificador que hoje pertença a outro projeto não é reutilizado.
      case
        when exists (
          select 1 from public.notes other
          where other.id = (v_note ->> 'id')::uuid and other.project_id <> v_version.project_id
        ) then gen_random_uuid()
        else (v_note ->> 'id')::uuid
      end,
      v_version.project_id,
      v_note ->> 'block',
      v_note ->> 'content',
      (v_note ->> 'position')::double precision
    )
    on conflict (id) do update
      set block = excluded.block,
          content = excluded.content,
          position = excluded.position,
          deleted_at = null;
  end loop;

  perform set_config('agitar.suppress_events', 'off', true);

  perform private.log_event(v_version.project_id, 'version_restored', null, null, null,
    jsonb_build_object('label', v_version.label, 'version_id', v_version.id));
end
$$;

-- ---------------------------------------------------------------------------
-- Duplicação
-- ---------------------------------------------------------------------------

-- Cria uma cópia do projeto em nome do usuário atual. Pessoas, convites,
-- links, histórico e versões não são copiados.
create function public.duplicate_project(p_project uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.projects;
  v_new uuid;
begin
  perform private.require(private.is_member(p_project), 'forbidden');

  select p.* into v_source from public.projects p where p.id = p_project;

  insert into public.projects (name, description, organization, responsible, participants, status)
  values (
    left(v_source.name, 151) || ' (cópia)',
    v_source.description,
    v_source.organization,
    v_source.responsible,
    v_source.participants,
    v_source.status
  )
  returning id into v_new;

  perform set_config('agitar.suppress_events', 'on', true);

  insert into public.notes (project_id, block, content, position)
  select v_new, n.block, n.content, n.position
  from public.notes n
  where n.project_id = p_project and n.deleted_at is null
  order by n.block, n.position, n.created_at;

  perform set_config('agitar.suppress_events', 'off', true);

  return v_new;
end
$$;

-- ---------------------------------------------------------------------------
-- Privilégios das funções expostas
-- ---------------------------------------------------------------------------

revoke all on all functions in schema public from public, anon;
revoke all on all functions in schema private from public, anon, authenticated;

-- Do esquema "private", o cliente só precisa das funções usadas nas políticas.
grant execute on function private.project_role(uuid) to authenticated;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.can_edit(uuid) to authenticated;
grant execute on function private.is_owner(uuid) to authenticated;
grant execute on function private.shares_project_with(uuid) to authenticated;
grant execute on function private.current_user_email() to authenticated;

grant execute on function public.agitar_block_limit(text) to authenticated;
grant execute on function public.invite_member(uuid, text, public.project_role) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.my_invites() to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.decline_invite(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.project_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_project(uuid) to authenticated;
grant execute on function public.create_link(uuid, public.project_role, integer) to authenticated;
grant execute on function public.revoke_link(uuid) to authenticated;
grant execute on function public.join_via_link(text) to authenticated;
grant execute on function public.create_version(uuid, text) to authenticated;
grant execute on function public.restore_version(uuid) to authenticated;
grant execute on function public.duplicate_project(uuid) to authenticated;
