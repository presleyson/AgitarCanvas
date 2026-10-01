// Bibliotecas
import { Dialog, DialogContent, DialogTitle } from '@radix-ui/react-dialog'
import { RxCross1 } from 'react-icons/rx';
import { useState } from 'react'
// Componentes
import PopUp from '../pop-up';
import { sectionTitles } from '../../utils/strings';
import './style.css'

const options = [{ value: '', label: 'Selecione...' }, ...sectionTitles.map(t => ({ value: t, label: t }))];

export default function ModalAddPostIt({ open, close, save, title, description, editId }) {
  const [form, setForm] = useState({
    title: title || '',
    description: description || '',
  });
  const [error, setError] = useState('');
  const [editConfirmationOpen, setEditConfirmationOpen] = useState(false);

  const onChange = (field) => (event) => {
    setForm({ ...form, [field]: event.target.value });
    setError('');
  };

  // Tenta salvar; em caso de erro, mantém o modal aberto com o texto digitado.
  const trySave = () => {
    const erro = save(form.title, form.description);
    if (erro) {
      setError(erro);
      return;
    }
    close();
  };

  const sendForm = (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;

    if (editId !== null) {
      setEditConfirmationOpen(true);
    } else {
      trySave();
    }
  };

  const confirmEdit = () => {
    setEditConfirmationOpen(false);
    trySave();
  };

  return (
    <Dialog open={open} onOpenChange={(aberto) => { if (!aberto) close(); }}>
      {editConfirmationOpen && (
        <PopUp
          open={editConfirmationOpen}
          message="Tem certeza de que deseja editar este post-it?"
          close={() => setEditConfirmationOpen(false)}
          confirm="Confirmar"
          cancel="Cancelar"
          confirmFnct={confirmEdit}
        />
      )}

      <DialogContent aria-describedby={undefined}>
        <div id='background-moldalAddPostIt'>
          <div id='container-moldalAddPostIt'>
            <div id="container-icon-moldalAddPostIt">
              <button type="button" id="icon-moldalAddPostIt" onClick={close} aria-label="Fechar">
                <RxCross1 />
              </button>
            </div>
            <DialogTitle className='sr-only'>{editId !== null ? 'Editar post-it' : 'Adicionar post-it'}</DialogTitle>
            <form id='form-modalAddPostIt' onSubmit={sendForm}>
              <div className='div-content-moldalAddPostIt'>
                <label htmlFor="select-modalAddPostIt">Seção</label>
                <select
                  id="select-modalAddPostIt"
                  name="title"
                  required
                  value={form.title}
                  onChange={onChange('title')}
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className='div-content-moldalAddPostIt'>
                <label htmlFor="textarea-modalAddPostIt">Descrição</label>
                <textarea
                  name="description"
                  required
                  id='textarea-modalAddPostIt'
                  value={form.description}
                  onChange={onChange('description')}
                />
              </div>
              {error && <p role="alert" className='erro-modalAddPostIt'>{error}</p>}
              <button type="submit" id='btn-modalAddPostIt'>Salvar</button>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
