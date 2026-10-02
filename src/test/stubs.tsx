import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import { LocalRepository } from '@/data/local/LocalRepository';
import type { ReceivedInvite, Repository, SharingApi } from '@/data/repository';
import type { Invite, Member, Person, Role, ShareLink } from '@/domain/types';
import { AppError } from '@/lib/errors';
import { RepositoryProvider } from '@/state/RepositoryContext';

type GrantRole = Exclude<Role, 'owner'>;

export const OWNER: Person = { id: 'ana', name: 'Ana Proprietária', email: 'ana@exemplo.com' };

/** Compartilhamento em memória, com as mesmas regras de resultado do servidor. */
export function memorySharing(
  received: ReceivedInvite[] = [],
): SharingApi & { members: Member[]; invites: Invite[]; links: ShareLink[]; received: ReceivedInvite[] } {
  const state = {
    received: [...received],
    members: [{ user: OWNER, role: 'owner' as Role, joinedAt: new Date().toISOString() }] as Member[],
    invites: [] as Invite[],
    links: [] as ShareLink[],
  };
  let sequence = 0;

  return Object.assign(state, {
    listMembers: async () => [...state.members],
    setRole: async (_project: string, userId: string, role: GrantRole) => {
      state.members = state.members.map((member) => (member.user.id === userId ? { ...member, role } : member));
    },
    removeMember: async (_project: string, userId: string) => {
      state.members = state.members.filter((member) => member.user.id !== userId);
    },
    leave: async () => undefined,
    invite: async (_project: string, email: string, role: GrantRole) => {
      if (state.members.some((member) => member.user.email === email)) return 'already_member' as const;
      state.invites = state.invites.filter((invite) => invite.email !== email);
      state.invites.push({ id: `convite-${(sequence += 1)}`, email, role, createdAt: new Date().toISOString() });
      return 'invited' as const;
    },
    listInvites: async () => [...state.invites],
    revokeInvite: async (inviteId: string) => {
      state.invites = state.invites.filter((invite) => invite.id !== inviteId);
    },
    listReceivedInvites: async (): Promise<ReceivedInvite[]> => [...state.received],
    acceptInvite: async (inviteId: string) => {
      const invite = state.received.find((candidate) => candidate.id === inviteId);
      if (!invite) throw new AppError('not_found');
      state.received = state.received.filter((candidate) => candidate.id !== inviteId);
      return invite.projectId;
    },
    declineInvite: async (inviteId: string) => {
      state.received = state.received.filter((candidate) => candidate.id !== inviteId);
    },
    listLinks: async () => [...state.links],
    createLink: async (_project: string, role: GrantRole, expiresInDays: number | null) => {
      const link: ShareLink = {
        id: `link-${(sequence += 1)}`,
        token: `token${sequence}`.padEnd(64, '0'),
        role,
        createdAt: new Date().toISOString(),
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null,
      };
      state.links.unshift(link);
      return link;
    },
    revokeLink: async (linkId: string) => {
      state.links = state.links.filter((link) => link.id !== linkId);
    },
    joinViaLink: async (token: string) => {
      if (!state.links.some((link) => link.token === token)) throw new AppError('invalid_link');
      return 'projeto';
    },
  });
}

/** Repositório local apresentado como modo nuvem, com compartilhamento em memória. */
export function cloudLikeRepository(sharing: SharingApi, user: Person = OWNER): Repository {
  const base = new LocalRepository();
  const snapshot = { status: 'signed_in' as const, user };
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'mode') return 'cloud';
      if (property === 'sharing') return sharing;
      if (property === 'auth') return { ...target.auth, getSnapshot: () => snapshot };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Repository;
}

export function renderWithProviders(ui: ReactElement, repository: Repository) {
  return render(
    <RepositoryProvider repository={repository}>
      <ToastProvider>{ui}</ToastProvider>
    </RepositoryProvider>,
  );
}
