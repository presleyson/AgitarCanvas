import { render, screen, within, fireEvent } from '@testing-library/react';
import Home from './index';
import validaQuantidade from '../utils/validaQuantidade';
import { sections } from '../utils/strings';

function abrirNovo() {
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar Post-it' }));
}

function preencher(secao, texto) {
  fireEvent.change(screen.getByLabelText('Seção'), { target: { value: secao } });
  fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: texto } });
}

function salvar() {
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
}

function adicionar(secao, texto) {
  abrirNovo();
  preencher(secao, texto);
  salvar();
}

const secao = (slug) => screen.getByTestId(`secao-${slug}`);

test('cria um post-it na seção escolhida', () => {
  render(<Home />);
  adicionar('Mercado', 'PMEs de TIC');
  expect(within(secao('mercado')).getByText('PMEs de TIC')).toBeInTheDocument();
});

test('defeito 1: cancelar uma edição e depois adicionar cria um novo post-it em vez de sobrescrever', () => {
  render(<Home />);
  adicionar('Mercado', 'Original');

  fireEvent.click(within(secao('mercado')).getByTitle('Editar'));
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));

  adicionar('Mercado', 'Novo');

  expect(within(secao('mercado')).getByText('Original')).toBeInTheDocument();
  expect(within(secao('mercado')).getByText('Novo')).toBeInTheDocument();
});

test('defeito 2: não salva post-it sem seção nem com descrição em branco', () => {
  render(<Home />);
  abrirNovo();
  preencher('', 'Sem seção');
  salvar();
  expect(screen.getByLabelText('Seção')).toBeInTheDocument(); // modal continua aberto
  sections.forEach(({ slug }) => {
    expect(within(secao(slug)).queryByText('Sem seção')).not.toBeInTheDocument();
  });

  preencher('Problema', '   ');
  salvar();
  expect(screen.getByRole('alert')).toHaveTextContent('Preencha a descrição.');
});

test('defeito 3: o limite de "Ideias Selecionadas" é aplicado', () => {
  const cinco = Array.from({ length: 5 }, (_, i) => ({ id: String(i), title: 'Ideias Selecionadas', text: 'x' }));
  expect(validaQuantidade('Ideias Selecionadas', cinco, null)).toMatch(/limite de 5/);
  expect(validaQuantidade('Ideias Selecionadas', cinco.slice(1), null)).toBeNull();
});

test('todas as seções têm limite definido', () => {
  sections.forEach(({ title }) => {
    const cheio = Array.from({ length: 10 }, (_, i) => ({ id: String(i), title, text: 'x' }));
    expect(validaQuantidade(title, cheio, null)).not.toBeNull();
  });
});

test('defeito 4: ao atingir o limite o modal continua aberto e o texto é preservado', () => {
  render(<Home />);
  adicionar('Mercado', 'Um');
  adicionar('Mercado', 'Dois');
  adicionar('Mercado', 'Terceiro');

  expect(screen.getByRole('alert')).toHaveTextContent('limite de 2');
  expect(screen.getByLabelText('Descrição')).toHaveValue('Terceiro');
});

test('editar um post-it em seção cheia é permitido', () => {
  render(<Home />);
  adicionar('Mercado', 'Um');
  adicionar('Mercado', 'Dois');

  fireEvent.click(within(secao('mercado')).getAllByTitle('Editar')[0]);
  fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Um editado' } });
  salvar();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  expect(within(secao('mercado')).getByText('Um editado')).toBeInTheDocument();
  expect(within(secao('mercado')).getByText('Dois')).toBeInTheDocument();
});

test('apagar um post-it restaura o texto de orientação', () => {
  render(<Home />);
  adicionar('Resultados', 'Meta');
  fireEvent.click(within(secao('resultados')).getByRole('button', { name: 'Apagar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  expect(within(secao('resultados')).queryByText('Meta')).not.toBeInTheDocument();
  expect(within(secao('resultados')).getByText(/Apresente os resultados/)).toBeInTheDocument();
});
