import { limits } from './strings';

// Retorna uma mensagem de erro quando a seção já atingiu o limite de post-its, ou null quando é possível salvar.
// Na edição, o post-it só conta contra o limite se estiver sendo movido para outra seção.
export default function validaQuantidade(title, postIts, editId) {
  const limite = limits[title];
  if (limite === undefined) return null;

  const ocupados = postIts.filter(item => item.title === title && item.id !== editId).length;

  if (ocupados >= limite) {
    return `Você atingiu o limite de ${limite} post-its em "${title}".`;
  }

  return null;
}
