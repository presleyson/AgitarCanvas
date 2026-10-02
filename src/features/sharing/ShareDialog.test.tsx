import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@/domain/types';
import { LocalRepository } from '@/data/local/LocalRepository';
import { OWNER, cloudLikeRepository, memorySharing, renderWithProviders } from '@/test/stubs';
import { ShareDialog } from './ShareDialog';

const project: Project = {
  id: 'projeto',
  name: 'Projeto Alfa',
  description: '',
  organization: '',
  responsible: '',
  participants: [],
  status: 'draft',
  archivedAt: null,
  ownerId: OWNER.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'owner',
};

const BRUNO = { id: 'bruno', name: 'Bruno Colaborador', email: 'bruno@exemplo.com' };

function setup(role: Project['role'] = 'owner', withBruno = false) {
  const sharing = memorySharing();
  if (withBruno) sharing.members.push({ user: BRUNO, role: 'editor', joinedAt: new Date().toISOString() });
  renderWithProviders(<ShareDialog project={{ ...project, role }} onClose={() => undefined} />, cloudLikeRepository(sharing));
  return { sharing, user: userEvent.setup() };
}

describe('ShareDialog', () => {
  it('permite alterar o papel de um participante', async () => {
    const { sharing, user } = setup('owner', true);
    await screen.findByText('Bruno Colaborador');

    await user.selectOptions(screen.getByLabelText('Papel de Bruno Colaborador'), 'viewer');
    await waitFor(() => expect(sharing.members.find((member) => member.user.id === 'bruno')?.role).toBe('viewer'));
  });

  it('convidar nunca concede acesso de imediato, mesmo a quem já tem conta', async () => {
    const { sharing, user } = setup();
    await screen.findByText('Ana Proprietária');

    await user.type(screen.getByLabelText('Email da pessoa'), 'Bruno@Exemplo.com');
    await user.click(screen.getByRole('button', { name: 'Convidar' }));

    expect(await screen.findByText(/Convite pendente · Editor/)).toBeInTheDocument();
    expect(sharing.invites.map((invite) => invite.email)).toEqual(['bruno@exemplo.com']);
    expect(sharing.members.map((member) => member.user.id)).toEqual(['ana']);
  });

  it('registra convite pendente para quem ainda não tem conta e permite cancelar', async () => {
    const { sharing, user } = setup();
    await screen.findByText('Ana Proprietária');

    await user.type(screen.getByLabelText('Email da pessoa'), 'carla@exemplo.com');
    await user.selectOptions(screen.getByLabelText('Papel'), 'viewer');
    await user.click(screen.getByRole('button', { name: 'Convidar' }));

    expect(await screen.findByText(/Convite pendente · Visualizador/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Avisar por email' })).toHaveAttribute('href', expect.stringContaining('mailto:carla@exemplo.com'));

    await user.click(screen.getByRole('button', { name: 'Cancelar convite de carla@exemplo.com' }));
    await waitFor(() => expect(sharing.invites).toHaveLength(0));
  });

  it('recusa email inválido sem chamar o servidor', async () => {
    const { sharing, user } = setup();
    const invite = vi.spyOn(sharing, 'invite');
    await screen.findByText('Ana Proprietária');

    await user.type(screen.getByLabelText('Email da pessoa'), 'sem-arroba');
    await user.click(screen.getByRole('button', { name: 'Convidar' }));

    expect(await screen.findByText('Informe um email válido.')).toBeInTheDocument();
    expect(invite).not.toHaveBeenCalled();
  });

  it('remove o acesso de um participante após confirmação', async () => {
    const { sharing, user } = setup('owner', true);
    await screen.findByText('Bruno Colaborador');

    await user.click(screen.getByRole('button', { name: 'Remover Bruno Colaborador' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remover acesso?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remover acesso' }));

    await waitFor(() => expect(sharing.members.map((member) => member.user.id)).toEqual(['ana']));
  });

  it('cria e revoga link de acesso controlado', async () => {
    const { sharing, user } = setup();
    await screen.findByText('Ana Proprietária');

    await user.selectOptions(screen.getByLabelText('Validade do link'), '30');
    await user.click(screen.getByRole('button', { name: 'Criar link' }));

    expect(await screen.findByText('Link para visualizador')).toBeInTheDocument();
    expect(sharing.links[0]).toMatchObject({ role: 'viewer' });
    expect(sharing.links[0].expiresAt).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Revogar link' }));
    await waitFor(() => expect(sharing.links).toHaveLength(0));
  });

  it('quem não é proprietário apenas consulta as pessoas com acesso', async () => {
    setup('editor');
    expect(await screen.findByText('Ana Proprietária')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Convidar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar link' })).not.toBeInTheDocument();
  });

  it('no modo local explica por que o compartilhamento não está disponível', () => {
    renderWithProviders(<ShareDialog project={project} onClose={() => undefined} />, new LocalRepository());
    expect(screen.getByText(/O compartilhamento exige contas de usuário/)).toBeInTheDocument();
  });
});
