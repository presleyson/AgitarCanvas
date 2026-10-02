import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { TagInput } from '@/components/ui/TagInput';
import { STATUS_LABEL, type ProjectInput } from '@/domain/types';
import {
  LIMITS,
  STATUS_ORDER,
  emptyProjectInput,
  normalizeProjectInput,
  validateProjectInput,
  type ProjectErrors,
} from '@/domain/validation';
import { errorMessage } from '@/lib/errors';
import styles from './ProjectFormDialog.module.css';

interface ProjectFormDialogProps {
  mode: 'create' | 'edit';
  initial?: ProjectInput;
  onClose: () => void;
  /** Deve rejeitar em caso de falha; a mensagem é exibida no formulário. */
  onSubmit: (input: ProjectInput) => Promise<void>;
}

/** Formulário de dados do projeto, usado na criação e na edição. */
export function ProjectFormDialog({ mode, initial, onClose, onSubmit }: ProjectFormDialogProps) {
  const [value, setValue] = useState<ProjectInput>(initial ?? emptyProjectInput());
  const [errors, setErrors] = useState<ProjectErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof ProjectInput>(key: K, next: ProjectInput[K]) {
    setValue((current) => ({ ...current, [key]: next }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function submit() {
    const found = validateProjectInput(value);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setSubmitError(null);
    try {
      await onSubmit(normalizeProjectInput(value));
      onClose();
    } catch (error) {
      setSubmitError(errorMessage(error));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !saving && onClose()}
      title={mode === 'create' ? 'Novo projeto' : 'Dados do projeto'}
      description={
        mode === 'create'
          ? 'Identifique o planejamento. Você poderá alterar estes dados depois.'
          : 'Estas informações identificam o projeto na lista, nos relatórios e na impressão.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            {mode === 'create' ? 'Criar projeto' : 'Salvar alterações'}
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Nome do projeto" error={errors.name}>
          {(props) => (
            <Input
              {...props}
              value={value.name}
              maxLength={LIMITS.name}
              autoFocus={mode === 'create'}
              placeholder="Ex.: Novo portal de atendimento ao cliente"
              onChange={(event) => set('name', event.target.value)}
            />
          )}
        </Field>

        <div className={styles.row}>
          <Field label="Empresa ou organização" optional error={errors.organization}>
            {(props) => (
              <Input
                {...props}
                value={value.organization}
                maxLength={LIMITS.organization}
                onChange={(event) => set('organization', event.target.value)}
              />
            )}
          </Field>
          <Field label="Responsável" optional error={errors.responsible}>
            {(props) => (
              <Input
                {...props}
                value={value.responsible}
                maxLength={LIMITS.responsible}
                onChange={(event) => set('responsible', event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Participantes"
          optional
          hint="Pessoas envolvidas no planejamento. Pressione Enter ou vírgula para adicionar."
          error={errors.participants}
        >
          {(props) => (
            <TagInput
              {...props}
              value={value.participants}
              max={LIMITS.participants}
              placeholder="Nome do participante"
              onChange={(participants) => set('participants', participants)}
            />
          )}
        </Field>

        <Field label="Descrição" optional error={errors.description}>
          {(props) => (
            <Textarea
              {...props}
              value={value.description}
              maxLength={LIMITS.description}
              rows={3}
              placeholder="Contexto e objetivo do planejamento"
              onChange={(event) => set('description', event.target.value)}
            />
          )}
        </Field>

        <Field label="Status">
          {(props) => (
            <Select {...props} value={value.status} onChange={(event) => set('status', event.target.value as ProjectInput['status'])}>
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {submitError && (
          <p className={styles.submitError} role="alert">
            {submitError}
          </p>
        )}
        {/* Permite enviar com Enter nos campos de texto. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
