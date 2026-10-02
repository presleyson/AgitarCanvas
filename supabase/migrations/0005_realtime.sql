-- AGITAR Canvas — tempo real
--
-- 1. Alterações em projetos e notas são publicadas para os clientes
--    inscritos. O Supabase Realtime aplica as políticas de leitura (RLS)
--    antes de entregar cada inclusão ou atualização. Notas nunca são
--    excluídas fisicamente pelos clientes (exclusão lógica), de modo que a
--    exclusão também chega como atualização filtrada pelas políticas.
-- 2. Um canal privado por projeto, "project:<uuid>", leva a presença (quem
--    está conectado e o que está editando) e os avisos de mudança de acesso.
--    As políticas sobre realtime.messages só admitem participantes do projeto,
--    e os clientes só podem publicar presença.
-- 3. Mudanças de associação não são publicadas como alterações de tabela,
--    porque eventos de exclusão não passam pelas políticas de acesso. Em vez
--    disso, um gatilho envia um aviso ao canal privado do projeto.
--
-- Os blocos condicionais permitem aplicar a migração também em um Postgres
-- comum, usado nos testes automatizados.

create function private.topic_project_id(p_topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_topic ~ '^project:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substr(p_topic, 9)::uuid
  end
$$;

revoke all on function private.topic_project_id(text) from public, anon;
grant execute on function private.topic_project_id(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.projects;
    alter publication supabase_realtime add table public.notes;
  end if;
end
$$;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      create policy "canal do projeto: participantes recebem presenca e avisos"
        on realtime.messages for select to authenticated
        using (
          extension in ('presence', 'broadcast')
          and private.is_member(private.topic_project_id((select realtime.topic())))
        )
    $policy$;

    execute $policy$
      create policy "canal do projeto: participantes publicam presenca"
        on realtime.messages for insert to authenticated
        with check (
          extension = 'presence'
          and private.is_member(private.topic_project_id((select realtime.topic())))
        )
    $policy$;
  end if;
end
$$;

-- Avisa os participantes conectados quando o acesso de alguém muda (entrada,
-- mudança de papel, remoção ou exclusão do projeto). O cliente reage
-- recarregando o projeto; quem perdeu o acesso deixa de vê-lo.
create function private.notify_access_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
begin
  if tg_op = 'DELETE' then
    v_project := old.project_id;
  else
    v_project := new.project_id;
  end if;

  begin
    -- realtime.send só existe no Supabase; em outros ambientes o aviso é ignorado.
    execute 'select realtime.send($1, $2, $3, true)'
      using jsonb_build_object('project_id', v_project), 'access', 'project:' || v_project::text;
  exception when others then
    null;
  end;
  return null;
end
$$;

create trigger project_members_notify
  after insert or update or delete on public.project_members
  for each row execute function private.notify_access_change();
