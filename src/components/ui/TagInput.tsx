import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import styles from './TagInput.module.css';

interface TagInputProps {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  max?: number;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/** Lista de itens curtos (por exemplo, participantes). Enter ou vírgula adiciona. */
export function TagInput({ id, value, onChange, placeholder, max = 50, ...aria }: TagInputProps) {
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    const items = raw
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length === 0) return;

    const existing = new Set(value.map((item) => item.toLocaleLowerCase('pt-BR')));
    const next = [...value];
    for (const item of items) {
      const key = item.toLocaleLowerCase('pt-BR');
      if (!existing.has(key) && next.length < max) {
        existing.add(key);
        next.push(item);
      }
    }
    onChange(next);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      if (draft.trim()) {
        event.preventDefault();
        commit(draft);
      } else if (event.key === ',') {
        event.preventDefault();
      }
    } else if (event.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className={styles.box}>
      {value.map((item) => (
        <span key={item} className={styles.tag}>
          {item}
          <button
            type="button"
            className={styles.remove}
            aria-label={`Remover ${item}`}
            onClick={() => onChange(value.filter((other) => other !== item))}
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        className={styles.input}
        value={draft}
        placeholder={value.length === 0 ? placeholder : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (/[,;\n]/.test(text)) {
            event.preventDefault();
            commit(text);
          }
        }}
        {...aria}
      />
    </div>
  );
}
