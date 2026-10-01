// Estilos e Funções
import './style.css';

// Bloco do canvas. A propriedade "area" (left, right ou bottom) define apenas a variação visual.
export default function CanvaArea({ postIts, section, children }) {
  const { title, text, slug, area } = section;
  const vazio = !postIts.some(postIt => postIt.title === title);

  return (
    <div className={`canva-area canva-area-${area}`} data-testid={`secao-${slug}`}>
      <p className='title-canva-area'>{title}</p>
      {vazio && (
        <p className='text-canva-area' id={`text-canva-area-${slug}`}>{text}</p>
      )}
      {children}
    </div>
  );
}
