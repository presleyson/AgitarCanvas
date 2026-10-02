import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { BookOpen, HardDrive, LayoutGrid, LogOut, UserRound } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Field';
import { Logo } from '@/components/ui/Logo';
import { Menu } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { useAuth, useRepository } from '@/state/RepositoryContext';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: ReactNode;
  /** Largura do conteúdo: "content" centraliza em coluna; "full" ocupa a tela. */
  width?: 'content' | 'full';
}

/** Estrutura comum das páginas: cabeçalho com navegação e conta, conteúdo e rodapé. */
export function AppShell({ children, width = 'content' }: AppShellProps) {
  return (
    <>
      <AppHeader />
      <main className={cx(styles.main, width === 'content' && styles.contained)}>{children}</main>
      <AppFooter />
    </>
  );
}

export function AppHeader() {
  const repository = useRepository();
  const { user, status } = useAuth();
  const [editingName, setEditingName] = useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link to="/projetos" className={styles.brand} aria-label="AGITAR Canvas, página inicial">
          <Logo />
        </Link>

        <nav className={styles.nav} aria-label="Principal">
          <NavLink to="/projetos" className={({ isActive }) => cx(styles.navLink, isActive && styles.navActive)}>
            <LayoutGrid size={16} aria-hidden />
            <span>Meus Projetos</span>
          </NavLink>
          <NavLink to="/metodologia" className={({ isActive }) => cx(styles.navLink, isActive && styles.navActive)}>
            <BookOpen size={16} aria-hidden />
            <span>Metodologia</span>
          </NavLink>
        </nav>

        <div className={styles.account}>
          {repository.mode === 'local' && (
            <span className={styles.mode} title="Os dados ficam salvos apenas neste navegador">
              <HardDrive size={14} aria-hidden />
              <span>Modo local</span>
            </span>
          )}
          {status === 'signed_in' && user && (
            <Menu
              trigger={
                <button type="button" className={styles.avatarButton} aria-label={`Conta de ${user.name}`}>
                  <Avatar person={user} size={32} />
                </button>
              }
              items={[
                { type: 'label', label: user.email ?? user.name },
                { label: 'Alterar nome', icon: <UserRound size={16} aria-hidden />, onSelect: () => setEditingName(true) },
                ...(repository.mode === 'cloud'
                  ? [
                      { type: 'separator' as const },
                      {
                        label: 'Sair',
                        icon: <LogOut size={16} aria-hidden />,
                        onSelect: () => void repository.auth.signOut(),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
      </div>
      {editingName && user && <NameDialog currentName={user.name} onClose={() => setEditingName(false)} />}
    </header>
  );
}

function NameDialog({ currentName, onClose }: { currentName: string; onClose: () => void }) {
  const repository = useRepository();
  const toast = useToast();
  const [name, setName] = useState(currentName === 'Você' ? '' : currentName);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await repository.auth.updateName(name);
      toast({ message: 'Nome atualizado.', tone: 'success' });
      onClose();
    } catch (error) {
      toast({ message: errorMessage(error), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Seu nome"
      description="É assim que você aparece no histórico e para as pessoas com quem colabora."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!name.trim()}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void save();
        }}
      >
        <Field label="Nome">
          {(props) => (
            <Input {...props} value={name} maxLength={160} autoFocus onChange={(event) => setName(event.target.value)} />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

export function AppFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span>
          <strong>AGITAR Canvas</strong> · Modelo de gestão da inovação tecnológica para pequenas e médias empresas de
          TIC
        </span>
        <span>
          Lima (2024), Universidade FUMEC · <Link to="/metodologia">Sobre a metodologia</Link>
        </span>
      </div>
    </footer>
  );
}
