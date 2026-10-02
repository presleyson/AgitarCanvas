import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReceivedInvite } from '@/data/repository';
import { LocalRepository } from '@/data/local/LocalRepository';
import { cloudLikeRepository, memorySharing, renderWithProviders } from '@/test/stubs';
import { ReceivedInvites } from './ReceivedInvites';

const INVITES: ReceivedInvite[] = [
  {
    id: 'convite-1',
    projectId: 'projeto-alfa',
    projectName: 'Projeto Alfa',
    role: 'editor',
    invitedByName: 'Ana Proprietária',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'convite-2',
    projectId: 'projeto-beta',
    projectName: 'Projeto Beta',
    role: 'viewer',
    invitedByName: '',
    createdAt: new Date().toISOString(),
  },
];

describe('ReceivedInvites', () => {
  it('lista os convites e só concede acesso quando o convite é aceito', async () => {
    const sharing = memorySharing(INVITES);
    const accept = vi.spyOn(sharing, 'acceptInvite');
    const onAccepted = vi.fn();
    renderWithProviders(<ReceivedInvites onAccepted={onAccepted} />, cloudLikeRepository(sharing));
    const user = userEvent.setup();

    expect(await screen.findByText('Ana Proprietária convidou você como editor.')).toBeInTheDocument();
    expect(screen.getByText('Você recebeu um convite como visualizador.')).toBeInTheDocument();
    expect(accept).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Aceitar convite para Projeto Alfa' }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith('projeto-alfa'));
    expect(screen.queryByText('Projeto Alfa')).not.toBeInTheDocument();
    expect(screen.getByText('Projeto Beta')).toBeInTheDocument();
  });

  it('recusar remove o convite sem conceder acesso', async () => {
    const sharing = memorySharing(INVITES.slice(0, 1));
    const onAccepted = vi.fn();
    renderWithProviders(<ReceivedInvites onAccepted={onAccepted} />, cloudLikeRepository(sharing));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Recusar convite para Projeto Alfa' }));
    await waitFor(() => expect(sharing.received).toHaveLength(0));
    expect(onAccepted).not.toHaveBeenCalled();
    expect(screen.queryByText('Convites recebidos')).not.toBeInTheDocument();
  });

  it('não aparece no modo local', () => {
    renderWithProviders(<ReceivedInvites onAccepted={() => undefined} />, new LocalRepository());
    expect(screen.queryByText('Convites recebidos')).not.toBeInTheDocument();
  });
});
