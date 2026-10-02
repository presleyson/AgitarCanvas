-- Testes das regras de acesso, do controle de concorrência, do histórico e
-- das operações do servidor. Tudo roda em uma transação desfeita ao final.
--
-- Cada verificação imprime "ok" ou interrompe a execução com erro.

\set QUIET 1
\pset format unaligned
\pset tuples_only on

begin;

create schema test;
grant usage on schema test to anon, authenticated;

create table test.results (n serial, name text);
grant insert, select on test.results to anon, authenticated;
grant usage on sequence test.results_n_seq to anon, authenticated;

create function test.ok(p_condition boolean, p_name text) returns void
language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'FALHOU: %', p_name;
  end if;
  insert into test.results (name) values (p_name);
end $$;

-- Executa o comando e exige que falhe com mensagem contendo p_expected.
create function test.throws(p_sql text, p_expected text, p_name text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_expected in sqlerrm) > 0 then
      insert into test.results (name) values (p_name);
      return;
    end if;
    raise exception 'FALHOU: % (erro inesperado: %)', p_name, sqlerrm;
  end;
  raise exception 'FALHOU: % (o comando deveria ter sido recusado)', p_name;
end $$;

create function test.count(p_sql text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into v;
  return v;
end $$;

-- Quantidade de linhas afetadas por um comando de escrita.
create function test.affected(p_sql text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end $$;

-- Assume a identidade de um usuário autenticado (ou anônimo, com null).
create function test.login(p_user uuid) returns void
language plpgsql as $$
begin
  if p_user is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'anon', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
end $$;

-- Volta ao papel administrativo do teste, sem identidade de usuário.
create function test.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

grant execute on all functions in schema test to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Usuários
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@exemplo.com', now(), '{"full_name": "Ana Proprietária"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bruno@exemplo.com', now(), '{"name": "Bruno Colaborador"}'),
  ('00000000-0000-0000-0000-00000000000e', 'eva@exemplo.com', now(), '{"full_name": "Eva Estranha"}');

\set ana '''00000000-0000-0000-0000-00000000000a'''
\set bruno '''00000000-0000-0000-0000-00000000000b'''
\set carla '''00000000-0000-0000-0000-00000000000c'''
\set davi '''00000000-0000-0000-0000-00000000000d'''
\set eva '''00000000-0000-0000-0000-00000000000e'''
\set proj '''11111111-1111-1111-1111-111111111111'''

select test.ok((select count(*) = 3 from public.profiles), 'perfis criados a partir de auth.users');
select test.ok((select full_name = 'Bruno Colaborador' from public.profiles where id = :bruno::uuid), 'nome do perfil vem dos metadados');

-- ---------------------------------------------------------------------------
-- Acesso anônimo
-- ---------------------------------------------------------------------------

select test.login(null);
select test.throws('select * from public.projects', 'permission denied', 'anônimo não lê projetos');
select test.throws('select * from public.notes', 'permission denied', 'anônimo não lê notas');
select test.throws('select * from public.profiles', 'permission denied', 'anônimo não lê perfis');
select test.throws($$select public.join_via_link('x')$$, 'permission denied', 'anônimo não executa funções');
select test.logout();

-- ---------------------------------------------------------------------------
-- Criação de projeto
-- ---------------------------------------------------------------------------

select test.login(:ana);

insert into public.projects (id, name, organization)
values (:proj, '  Projeto Alfa  ', 'Empresa X')
returning id \gset created_

select test.ok(:'created_id' = :proj, 'criação devolve o projeto ao proprietário');
select test.ok((select name = 'Projeto Alfa' and owner_id = :ana::uuid from public.projects where id = :proj), 'nome normalizado e proprietário definido pelo servidor');
select test.ok((select role = 'owner' from public.project_members where project_id = :proj and user_id = :ana::uuid), 'proprietário registrado como membro');
select test.throws(format($$insert into public.projects (name, owner_id) values ('x', %L)$$, :bruno), 'permission denied', 'cliente não escolhe o proprietário');

insert into public.notes (id, project_id, block, content, position) values
  ('22222222-0000-0000-0000-000000000001', :proj, 'mercado', 'PMEs de TIC', 1),
  ('22222222-0000-0000-0000-000000000002', :proj, 'problema', 'Baixa maturidade em inovação', 1);

select test.ok((select version = 1 and created_by = :ana::uuid from public.notes where id = '22222222-0000-0000-0000-000000000001'), 'nota criada com versão 1 e autoria');
select test.throws($$insert into public.notes (project_id, block, content) values ('11111111-1111-1111-1111-111111111111', 'inexistente', 'x')$$, 'violates check constraint', 'bloco inexistente é recusado');
select test.logout();

-- ---------------------------------------------------------------------------
-- Isolamento: quem não participa não enxerga nem altera nada
-- ---------------------------------------------------------------------------

select test.login(:bruno);
select test.ok(test.count('select 1 from public.projects') = 0, 'estranho não vê projetos');
select test.ok(test.count('select 1 from public.notes') = 0, 'estranho não vê notas');
select test.ok(test.count('select 1 from public.project_members') = 0, 'estranho não vê membros');
select test.ok(test.count('select 1 from public.project_events') = 0, 'estranho não vê histórico');
select test.ok(test.count('select 1 from public.project_versions') = 0, 'estranho não vê versões');
select test.ok(test.count($$select 1 from public.profiles where id <> '00000000-0000-0000-0000-00000000000b'$$) = 0, 'estranho não vê perfis alheios');
select test.throws($$insert into public.notes (project_id, block, content) values ('11111111-1111-1111-1111-111111111111', 'mercado', 'invasão')$$, 'row-level security', 'estranho não cria nota');
select test.ok(test.affected($$update public.notes set content = 'invasão'$$) = 0, 'estranho não altera notas');
select test.ok(test.affected($$update public.projects set name = 'invasão'$$) = 0, 'estranho não altera projetos');
select test.ok(test.affected($$delete from public.projects$$) = 0, 'estranho não exclui projetos');
select test.throws($$select public.duplicate_project('11111111-1111-1111-1111-111111111111')$$, 'forbidden', 'estranho não duplica projeto');
select test.throws($$select public.create_version('11111111-1111-1111-1111-111111111111', 'x')$$, 'forbidden', 'estranho não cria versão');
select test.throws($$select public.invite_member('11111111-1111-1111-1111-111111111111', 'eva@exemplo.com', 'editor')$$, 'forbidden', 'estranho não convida');
select test.throws($$select public.create_link('11111111-1111-1111-1111-111111111111', 'editor')$$, 'forbidden', 'estranho não cria link');
select test.throws(format($$insert into public.project_members (project_id, user_id, role) values ('11111111-1111-1111-1111-111111111111', %L, 'owner')$$, :bruno), 'permission denied', 'ninguém se adiciona diretamente como membro');
select test.logout();

-- ---------------------------------------------------------------------------
-- Visualizador
-- ---------------------------------------------------------------------------

select test.login(:ana);
select test.ok(public.invite_member(:proj, ' Bruno@Exemplo.com ', 'viewer') = 'invited', 'convite fica pendente mesmo para quem já tem conta');
select test.ok(test.count($$select 1 from public.profiles where email = 'bruno@exemplo.com'$$) = 0, 'convidar não revela o perfil do convidado');
select test.throws($$select public.invite_member('11111111-1111-1111-1111-111111111111', 'sem-arroba', 'viewer')$$, 'invalid_email', 'email inválido é recusado');
select test.throws($$select public.invite_member('11111111-1111-1111-1111-111111111111', 'x@y.com', 'owner')$$, 'invalid_role', 'convite não concede papel de proprietário');
select test.logout();

-- O convite não dá acesso até ser aceito por quem foi convidado.
select test.login(:bruno);
select test.ok(test.count('select 1 from public.projects') = 0, 'convite pendente não inclui a pessoa no projeto');
select test.ok(test.count('select 1 from public.my_invites()') = 1, 'convidado vê o convite com o nome do projeto');
select test.ok((select project_name = 'Projeto Alfa' and invited_by_name = 'Ana Proprietária' and role = 'viewer' from public.my_invites()), 'convite informa projeto, autor e papel');
select test.logout();

select test.login(:eva);
select test.ok(test.count('select 1 from public.my_invites()') = 0, 'convite de outra pessoa não aparece');
select test.logout();

select id as bruno_invite from public.project_invites where email = 'bruno@exemplo.com' \gset
select test.login(:eva);
select test.throws(format($$select public.accept_invite(%L)$$, :'bruno_invite'), 'not_found', 'convite de outra pessoa não pode ser aceito');
select test.throws(format($$select public.decline_invite(%L)$$, :'bruno_invite'), 'not_found', 'convite de outra pessoa não pode ser recusado');
select test.logout();

select test.login(:bruno);
select test.ok(public.accept_invite(:'bruno_invite') = :proj::uuid, 'convidado aceita o convite');
select test.throws(format($$select public.accept_invite(%L)$$, :'bruno_invite'), 'not_found', 'convite não é aceito duas vezes');
select test.logout();

select test.login(:ana);
select test.ok(public.invite_member(:proj, 'bruno@exemplo.com', 'viewer') = 'already_member', 'convite a quem já participa é reconhecido');
select test.logout();

select test.login(:bruno);
select test.ok(test.count('select 1 from public.projects') = 1, 'visualizador vê o projeto');
select test.ok(test.count('select 1 from public.notes') = 2, 'visualizador vê as notas');
select test.ok(test.count($$select 1 from public.profiles where email = 'ana@exemplo.com'$$) = 1, 'visualizador vê o perfil de colegas de projeto');
select test.ok(test.count($$select 1 from public.profiles where email = 'eva@exemplo.com'$$) = 0, 'visualizador não vê perfis de fora do projeto');
select test.throws($$insert into public.notes (project_id, block, content) values ('11111111-1111-1111-1111-111111111111', 'geracao', 'x')$$, 'row-level security', 'visualizador não cria nota');
select test.ok(test.affected($$update public.notes set content = 'x'$$) = 0, 'visualizador não altera nota');
select test.ok(test.affected($$update public.notes set deleted_at = now()$$) = 0, 'visualizador não exclui nota');
select test.ok(test.affected($$update public.projects set name = 'x'$$) = 0, 'visualizador não altera projeto');
select test.throws($$select public.create_version('11111111-1111-1111-1111-111111111111', 'x')$$, 'forbidden', 'visualizador não cria versão');
select test.ok(test.count('select 1 from public.project_links') = 0, 'visualizador não vê links');
select test.logout();

-- ---------------------------------------------------------------------------
-- Editor
-- ---------------------------------------------------------------------------

select test.login(:ana);
select public.set_member_role(:proj, :bruno, 'editor');
select test.logout();

select test.login(:bruno);
select test.ok(test.affected($$update public.notes set content = 'PMEs de TIC em Minas Gerais' where id = '22222222-0000-0000-0000-000000000001' and version = 1$$) = 1, 'editor altera nota informando a versão atual');
select test.ok((select version = 2 and updated_by = :bruno::uuid from public.notes where id = '22222222-0000-0000-0000-000000000001'), 'gravação incrementa a versão e registra o autor');
select test.ok(test.affected($$update public.notes set content = 'gravação atrasada' where id = '22222222-0000-0000-0000-000000000001' and version = 1$$) = 0, 'gravação com versão desatualizada não sobrescreve');
select test.throws($$update public.notes set version = 99$$, 'permission denied', 'cliente não manipula a versão');
select test.throws($$update public.notes set project_id = gen_random_uuid()$$, 'permission denied', 'nota não muda de projeto');
select test.ok(test.affected($$update public.projects set status = 'active'$$) = 1, 'editor altera dados do projeto');
select test.throws($$update public.projects set archived_at = now()$$, 'owner_only', 'editor não arquiva');
select test.ok(test.affected($$delete from public.projects$$) = 0, 'editor não exclui projeto');
select test.throws(format($$select public.set_member_role('11111111-1111-1111-1111-111111111111', %L, 'editor')$$, :bruno), 'forbidden', 'editor não altera papéis');
select test.throws(format($$select public.remove_member('11111111-1111-1111-1111-111111111111', %L)$$, :ana), 'forbidden', 'editor não remove membros');
select test.throws($$select public.create_link('11111111-1111-1111-1111-111111111111', 'viewer')$$, 'forbidden', 'editor não cria link');
select test.ok(test.affected($$update public.profiles set full_name = 'x' where id = '00000000-0000-0000-0000-00000000000a'$$) = 0, 'ninguém altera o perfil de outra pessoa');
select test.throws($$update public.profiles set email = 'outro@exemplo.com'$$, 'permission denied', 'email do perfil não é editável pelo cliente');

-- Limite de notas por bloco
select test.ok(test.affected($$insert into public.notes (id, project_id, block, content, position) values ('22222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'mercado', 'Segundo mercado', 2)$$) = 1, 'segunda nota em Mercado é aceita');
select test.throws($$insert into public.notes (project_id, block, content) values ('11111111-1111-1111-1111-111111111111', 'mercado', 'Terceira')$$, 'block_full', 'terceira nota em Mercado é recusada');
select test.ok(test.affected($$insert into public.notes (id, project_id, block, content, position) values ('22222222-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'geracao', 'Ideia', 1)$$) = 1, 'nota em outro bloco é aceita');
select test.throws($$update public.notes set block = 'mercado' where id = '22222222-0000-0000-0000-000000000004'$$, 'block_full', 'mover para bloco cheio é recusado');
select test.ok(test.affected($$update public.notes set deleted_at = now() where id = '22222222-0000-0000-0000-000000000003'$$) = 1, 'editor exclui nota');
select test.ok(test.affected($$update public.notes set block = 'mercado' where id = '22222222-0000-0000-0000-000000000004'$$) = 1, 'mover é aceito depois de liberar espaço');
select test.throws($$update public.notes set deleted_at = null where id = '22222222-0000-0000-0000-000000000003'$$, 'block_full', 'desfazer exclusão respeita o limite');
select test.logout();

-- ---------------------------------------------------------------------------
-- Histórico
-- ---------------------------------------------------------------------------

select test.login(:bruno);
update public.notes set content = 'PMEs de TIC em MG' where id = '22222222-0000-0000-0000-000000000001';
update public.notes set content = 'PMEs de TIC de Minas Gerais' where id = '22222222-0000-0000-0000-000000000001';
select test.logout();

select test.ok((select count(*) = 1 from public.project_events where note_id = '22222222-0000-0000-0000-000000000001' and kind = 'note_updated'), 'gravações seguidas da mesma pessoa viram um único evento');
select test.ok((select before ->> 'content' = 'PMEs de TIC' and after ->> 'content' = 'PMEs de TIC de Minas Gerais' and actor_name = 'Bruno Colaborador' from public.project_events where note_id = '22222222-0000-0000-0000-000000000001' and kind = 'note_updated'), 'evento guarda conteúdo anterior, conteúdo final e autor');
select test.ok((select count(*) = 1 from public.project_events where kind = 'note_deleted' and before ->> 'content' = 'Segundo mercado'), 'exclusão registrada com o conteúdo removido');
select test.ok((select count(*) = 1 from public.project_events where kind = 'note_moved' and before ->> 'block' = 'geracao' and after ->> 'block' = 'mercado'), 'mudança de bloco registrada');
select test.ok((select after ->> 'status' = 'active' and before ->> 'status' = 'draft' and not (after ? 'name') from public.project_events where kind = 'project_updated'), 'alteração do projeto registra só os campos alterados');
select test.ok((select count(*) = 2 from public.project_events where kind = 'member_added' or kind = 'member_role_changed'), 'entrada e mudança de papel registradas');
select test.login(:bruno);
select test.throws($$insert into public.project_events (project_id, kind) values ('11111111-1111-1111-1111-111111111111', 'falso')$$, 'permission denied', 'histórico não aceita escrita direta');
select test.throws($$insert into public.project_versions (project_id, label, kind, snapshot) values ('11111111-1111-1111-1111-111111111111', 'x', 'manual', '{}')$$, 'permission denied', 'versões não aceitam escrita direta');
select test.throws($$delete from public.notes$$, 'permission denied', 'notas não aceitam exclusão física pelo cliente');
select test.logout();

-- ---------------------------------------------------------------------------
-- Versões e restauração
-- ---------------------------------------------------------------------------

select test.login(:bruno);
select public.create_version(:proj, 'Marco 1') as id \gset version_
update public.notes set content = 'Conteúdo alterado depois do marco' where id = '22222222-0000-0000-0000-000000000002';
update public.notes set deleted_at = now() where id = '22222222-0000-0000-0000-000000000004';
insert into public.notes (id, project_id, block, content, position) values ('22222222-0000-0000-0000-000000000005', :proj, 'resultados', 'Criada depois do marco', 1);
select public.restore_version(:'version_id');
select test.ok((select content = 'Baixa maturidade em inovação' from public.notes where id = '22222222-0000-0000-0000-000000000002'), 'restauração recupera o conteúdo');
select test.ok((select deleted_at is null and block = 'mercado' from public.notes where id = '22222222-0000-0000-0000-000000000004'), 'restauração recupera nota excluída');
select test.ok((select deleted_at is not null from public.notes where id = '22222222-0000-0000-0000-000000000005'), 'restauração remove nota criada depois');
select test.ok(test.count($$select 1 from public.project_versions where kind = 'restore'$$) = 1, 'estado anterior à restauração fica guardado');
select test.ok(test.count($$select 1 from public.project_events where kind = 'version_restored'$$) = 1, 'restauração gera um único evento');
select test.logout();

select test.ok((select count(*) = 0 from public.project_events where note_id = '22222222-0000-0000-0000-000000000005' and kind = 'note_deleted'), 'restauração não polui o histórico com eventos por nota');

-- Versão automática: primeira alteração depois de 24 horas sem versões
select test.ok((select count(*) = 0 from public.project_versions where kind = 'auto'), 'projeto recém-criado não gera versão automática');
set local session_replication_role = replica;
update public.projects set created_at = now() - interval '3 days';
update public.project_versions set created_at = now() - interval '2 days';
set local session_replication_role = origin;
select test.login(:bruno);
update public.notes set content = 'Nova rodada' where id = '22222222-0000-0000-0000-000000000002';
select test.ok(test.count($$select 1 from public.project_versions where kind = 'auto'$$) = 1, 'versão automática criada antes da primeira alteração do dia');
select test.ok((select snapshot -> 'notes' @> '[{"content": "Baixa maturidade em inovação"}]' from public.project_versions where kind = 'auto'), 'versão automática guarda o estado anterior à alteração');
update public.notes set content = 'Nova rodada 2' where id = '22222222-0000-0000-0000-000000000002';
select test.ok(test.count($$select 1 from public.project_versions where kind = 'auto'$$) = 1, 'no máximo uma versão automática por dia');
select test.logout();

-- ---------------------------------------------------------------------------
-- Convite pendente
-- ---------------------------------------------------------------------------

select test.login(:ana);
select test.ok(public.invite_member(:proj, 'carla@exemplo.com', 'editor') = 'invited', 'convite a quem não tem conta fica pendente');
select test.ok(test.count('select 1 from public.project_invites') = 1, 'proprietário vê convites pendentes');
select test.logout();

select test.login(:bruno);
select test.ok(test.count('select 1 from public.project_invites') = 0, 'editor não vê convites de terceiros');
select test.logout();

select id as carla_invite from public.project_invites where email = 'carla@exemplo.com' \gset

insert into auth.users (id, email, email_confirmed_at) values (:carla, 'carla@exemplo.com', null);
select test.login(:carla);
select test.ok(test.count('select 1 from public.my_invites()') = 0, 'email não confirmado não vê convites');
select test.throws(format($$select public.accept_invite(%L)$$, :'carla_invite'), 'not_found', 'email não confirmado não aceita convite');
select test.logout();

update auth.users set email_confirmed_at = now() where id = :carla::uuid;
select test.login(:carla);
select test.ok(test.count('select 1 from public.project_invites') = 1, 'convidada vê o próprio convite');
select test.ok(test.count('select 1 from public.notes') = 0, 'antes de aceitar, convidada não vê as notas');
select test.ok(public.accept_invite(:'carla_invite') = :proj::uuid, 'convite aceito pela convidada');
select test.ok(test.count('select 1 from public.notes') > 0, 'convidada passa a ver as notas');
select test.ok((select role = 'editor' from public.project_members where user_id = :carla::uuid), 'papel vem do convite');
select test.logout();

-- Convite recusado é removido sem conceder acesso.
select test.login(:ana);
select public.invite_member(:proj, 'eva@exemplo.com', 'editor');
select test.logout();
select id as eva_invite from public.project_invites where email = 'eva@exemplo.com' \gset
select test.login(:eva);
select public.decline_invite(:'eva_invite');
select test.ok(test.count('select 1 from public.projects') = 0, 'convite recusado não dá acesso');
select test.logout();
select test.ok((select count(*) = 0 from public.project_invites where email = 'eva@exemplo.com'), 'convite recusado é removido');

-- ---------------------------------------------------------------------------
-- Link de acesso
-- ---------------------------------------------------------------------------

select test.login(:ana);
select token from public.create_link(:proj, 'viewer', 7) \gset link_
select id as old_id, token as old_token from public.create_link(:proj, 'editor') \gset link_
select public.revoke_link(:'link_old_id');
select test.logout();

insert into auth.users (id, email, email_confirmed_at) values (:davi, 'davi@exemplo.com', now());
select test.login(:davi);
select test.throws($$select public.join_via_link('token-inexistente')$$, 'invalid_link', 'token desconhecido é recusado');
select test.throws(format($$select public.join_via_link(%L)$$, :'link_old_token'), 'invalid_link', 'link revogado é recusado');
select test.ok(public.join_via_link(:'link_token') = :proj::uuid, 'link válido dá acesso ao projeto');
select test.ok((select role = 'viewer' from public.project_members where user_id = :davi::uuid), 'papel vem do link');
select test.logout();

update public.project_links set expires_at = now() - interval '1 minute' where token = :'link_token';
select test.login(:eva);
select test.throws(format($$select public.join_via_link(%L)$$, :'link_token'), 'invalid_link', 'link expirado é recusado');
select test.logout();

-- ---------------------------------------------------------------------------
-- Duplicação, saída e remoção
-- ---------------------------------------------------------------------------

select test.login(:davi);
select public.duplicate_project(:proj) as id \gset copy_
select test.ok((select owner_id = :davi::uuid and name = 'Projeto Alfa (cópia)' from public.projects where id = :'copy_id'), 'duplicação cria projeto próprio');
select test.ok((select count(*) from public.notes where project_id = :'copy_id') = (select count(*) from public.notes where project_id = :proj and deleted_at is null), 'duplicação copia as notas ativas');
select test.ok(test.count(format($$select 1 from public.project_members where project_id = %L$$, :'copy_id')) = 1, 'duplicação não copia pessoas');
select public.leave_project(:proj);
select test.ok(test.count(format($$select 1 from public.projects where id = %L$$, :proj)) = 0, 'quem sai perde o acesso');
select test.logout();

select test.login(:ana);
select test.throws($$select public.leave_project('11111111-1111-1111-1111-111111111111')$$, 'owner_cannot_leave', 'proprietário não abandona o projeto');
select test.throws(format($$select public.remove_member('11111111-1111-1111-1111-111111111111', %L)$$, :ana), 'forbidden', 'proprietário não é removido');
select public.remove_member(:proj, :bruno);
select test.logout();

select test.login(:bruno);
select test.ok(test.count('select 1 from public.projects') = 0, 'membro removido perde o acesso ao projeto');
select test.ok(test.count('select 1 from public.notes') = 0, 'membro removido perde o acesso às notas');
select test.logout();

-- ---------------------------------------------------------------------------
-- Validação de valores e privilégios residuais
-- ---------------------------------------------------------------------------

select test.login(:ana);
select test.throws($$update public.projects set participants = array[null]::text[]$$, 'violates check constraint', 'participante nulo é recusado');
select test.throws(format($$update public.projects set participants = array[%L]$$, repeat('x', 161)), 'violates check constraint', 'nome de participante longo demais é recusado');
select test.throws($$update public.notes set position = 'NaN'$$, 'violates check constraint', 'posição inválida é recusada');
select test.throws($$update public.profiles set avatar_url = 'javascript:alert(1)'$$, 'violates check constraint', 'endereço de foto fora do padrão é recusado');
select test.throws($$select nextval('public.project_events_id_seq')$$, 'permission denied', 'sequências não são acessíveis ao cliente');
select test.logout();

-- ---------------------------------------------------------------------------
-- Exclusão de conta
-- ---------------------------------------------------------------------------

-- Carla editou uma nota do projeto da Ana e depois teve a conta excluída.
select test.login(:carla);
update public.notes set content = 'Editada pela Carla' where id = '22222222-0000-0000-0000-000000000002';
select test.logout();
select version as before_version from public.notes where id = '22222222-0000-0000-0000-000000000002' \gset
delete from auth.users where id = :carla::uuid;
select test.ok((select count(*) = 0 from public.profiles where id = :carla::uuid), 'excluir a conta remove o perfil');
select test.ok((select updated_by is null and content = 'Editada pela Carla' and version = :before_version from public.notes where id = '22222222-0000-0000-0000-000000000002'), 'as contribuições permanecem, sem autoria e sem alterar a versão');
select test.ok((select count(*) > 0 from public.project_events where actor_id is null and actor_name = 'carla'), 'o histórico preserva o nome de quem contribuiu');

-- ---------------------------------------------------------------------------
-- Arquivamento e exclusão
-- ---------------------------------------------------------------------------

select test.login(:ana);
update public.projects set archived_at = now() where id = :proj;
select test.throws($$update public.notes set content = 'x' where id = '22222222-0000-0000-0000-000000000002'$$, 'project_archived', 'projeto arquivado é somente leitura');
select test.throws($$update public.projects set name = 'Outro nome' where id = '11111111-1111-1111-1111-111111111111'$$, 'project_archived', 'dados de projeto arquivado não são alterados');
select test.throws($$select public.create_version('11111111-1111-1111-1111-111111111111', 'x')$$, 'project_archived', 'projeto arquivado não recebe novas versões');
update public.projects set archived_at = null where id = :proj;
select test.ok(test.affected($$update public.notes set content = 'x' where id = '22222222-0000-0000-0000-000000000002'$$) = 1, 'projeto desarquivado volta a aceitar edição');
select test.ok(test.affected(format($$delete from public.projects where id = %L$$, :proj)) = 1, 'proprietário exclui o projeto');
select test.logout();

select test.ok((select count(*) = 0 from public.notes where project_id = :proj), 'exclusão remove as notas');
select test.ok((select count(*) = 0 from public.project_events where project_id = :proj), 'exclusão remove o histórico');

-- Excluir a conta de quem é proprietário remove também os projetos dela.
select test.login(:eva);
insert into public.projects (id, name) values ('33333333-3333-3333-3333-333333333333', 'Projeto da Eva');
insert into public.notes (project_id, block, content) values ('33333333-3333-3333-3333-333333333333', 'mercado', 'Nota da Eva');
select test.logout();
set local session_replication_role = replica;
update public.projects set created_at = now() - interval '3 days' where id = '33333333-3333-3333-3333-333333333333';
set local session_replication_role = origin;
delete from auth.users where id = :eva::uuid;
select test.ok((select count(*) = 0 from public.projects where id = '33333333-3333-3333-3333-333333333333'), 'excluir a conta do proprietário remove seus projetos');

select count(*) || ' verificações concluídas com sucesso' from test.results;

rollback;
