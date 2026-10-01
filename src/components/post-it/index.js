// Bibliotecas
import React, { useState } from 'react';
// Estilos e Funções
import './style.css';

export default function PostIt({ text, open, deletePostIt }) {
  const [isMouseOver, setIsMouseOver] = useState(false);

  return (
    <div
      className="postIt-main-container"
      onMouseEnter={() => setIsMouseOver(true)}
      onMouseLeave={() => setIsMouseOver(false)}
    >
      <button type="button" className='postIt-container' onClick={open} title="Editar">
        <p className='postIt-content'>{isMouseOver ? 'Editar' : text}</p>
      </button>
      <button
        type="button"
        className={`btn-delete-postIt ${isMouseOver ? 'visible' : 'hidden'}`}
        onClick={deletePostIt}
        onFocus={() => setIsMouseOver(true)}
        onBlur={() => setIsMouseOver(false)}
      >
        Apagar
      </button>
    </div>
  );
}
