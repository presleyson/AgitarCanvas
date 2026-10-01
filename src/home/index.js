// Bibliotecas
import { useState } from 'react';
import * as uuid from 'uuid';
// Componentes
import PostItArea from '../components/post-it-area';
import CanvaArea from '../components/canva-area';
import ModalAddPostIt from '../components/modal';
import PopUp from '../components/pop-up';
// Estilos e Funções
import { sectionsByArea, sectionTitles } from '../utils/strings';
import validaQuantidade from '../utils/validaQuantidade';
import './style.css';


export default function Home() {
  const [postIts, setPostIts] = useState([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editId, setEditId] = useState(null);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [postToDeleteId, setPostToDeleteId] = useState(null);

  // Salva (cria ou edita) um post-it. Retorna uma mensagem de erro ou null em caso de sucesso.
  function savePostIt(title, text) {
    const texto = (text || '').trim();

    if (!sectionTitles.includes(title)) {
      return 'Selecione uma seção.';
    }
    if (texto === '') {
      return 'Preencha a descrição.';
    }

    const editando = editId !== null && postIts.some(postIt => postIt.id === editId);
    const erroLimite = validaQuantidade(title, postIts, editando ? editId : null);
    if (erroLimite) {
      return erroLimite;
    }

    if (editando) {
      setPostIts(postIts.map(postIt =>
        postIt.id === editId ? { ...postIt, title, text: texto } : postIt
      ));
    } else {
      setPostIts([...postIts, { id: uuid.v4(), title, text: texto }]);
    }
    return null;
  }

  function resetForm() {
    setTitle('');
    setDescription('');
    setEditId(null);
  }

  function editModal(title, text, id) {
    setTitle(title);
    setDescription(text);
    setEditId(id);
    setOpen(true);
  }

  function deletePostIt(id) {
    setPostToDeleteId(id);
    setDeleteConfirmationOpen(true);
  }

  function confirmDelete() {
    setPostIts(postIts.filter((postIt) => postIt.id !== postToDeleteId));
    setPostToDeleteId(null);
    setDeleteConfirmationOpen(false);
  }

  function cancelDelete() {
    setPostToDeleteId(null);
    setDeleteConfirmationOpen(false);
  }

  function openModal() {
    resetForm();
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    resetForm();
  }

  function renderArea(section) {
    return (
      <CanvaArea key={section.slug} postIts={postIts} section={section}>
        <PostItArea postIts={postIts} editModal={editModal} deletePostIt={deletePostIt} title={section.title} />
      </CanvaArea>
    );
  }

  return (
    <>
      {open && (
        <ModalAddPostIt
          open={open}
          close={closeModal}
          save={savePostIt}
          title={title}
          description={description}
          editId={editId}
        />
      )}
      {deleteConfirmationOpen && (
        <PopUp
          open={deleteConfirmationOpen}
          message="Tem certeza de que deseja excluir este post-it?"
          close={cancelDelete}
          confirm="Confirmar"
          cancel="Cancelar"
          confirmFnct={confirmDelete}
        />
      )}

      <div id='canva-container-main'>
        <div id='canva-container-top'>
          {sectionsByArea('left').map(renderArea)}
          <div id='canva-container-right'>
            {sectionsByArea('right').map(renderArea)}
          </div>
        </div>
        <div id='canva-container-bottom'>
          {sectionsByArea('bottom').map(renderArea)}
        </div>
        <button id='button-canva' onClick={openModal}>Adicionar Post-it</button>
      </div>
    </>
  );
}
