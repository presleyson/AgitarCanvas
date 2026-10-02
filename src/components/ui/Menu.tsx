import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './Menu.module.css';

export type MenuItem =
  | {
      type?: 'item';
      label: string;
      icon?: ReactNode;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { type: 'separator' }
  | { type: 'label'; label: string };

interface MenuProps {
  /** Elemento que abre o menu (um botão). */
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
}

export function Menu({ trigger, items, align = 'end' }: MenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.content} align={align} sideOffset={6} collisionPadding={12}>
          {items.map((item, index) => {
            if (item.type === 'separator') {
              return <DropdownMenu.Separator key={index} className={styles.separator} />;
            }
            if (item.type === 'label') {
              return (
                <DropdownMenu.Label key={index} className={styles.label}>
                  {item.label}
                </DropdownMenu.Label>
              );
            }
            return (
              <DropdownMenu.Item
                key={index}
                className={cx(styles.item, item.danger && styles.danger)}
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                {item.icon && <span className={styles.icon}>{item.icon}</span>}
                <span className={styles.text}>{item.label}</span>
                {item.hint && <span className={styles.hint}>{item.hint}</span>}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
