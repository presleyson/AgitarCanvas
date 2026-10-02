import { describe, expect, it } from 'vitest';
import { filledBlocks, progressPercent } from './progress';
import { emptyProjectInput, isValidEmail, normalizeProjectInput, validateProjectInput } from './validation';

describe('validação dos dados do projeto', () => {
  it('exige nome', () => {
    expect(validateProjectInput({ ...emptyProjectInput(), name: '   ' })).toEqual({ name: 'Informe o nome do projeto.' });
  });

  it('aceita dados mínimos', () => {
    expect(validateProjectInput({ ...emptyProjectInput(), name: 'Projeto' })).toEqual({});
  });

  it('limita o tamanho dos campos', () => {
    const errors = validateProjectInput({ ...emptyProjectInput(), name: 'x'.repeat(161), description: 'y'.repeat(2001) });
    expect(Object.keys(errors)).toEqual(['name', 'description']);
  });

  it('normaliza espaços e remove participantes repetidos', () => {
    const value = normalizeProjectInput({
      ...emptyProjectInput(),
      name: '  Projeto  ',
      participants: [' Ana ', 'ana', '', 'Bruno'],
    });
    expect(value.name).toBe('Projeto');
    expect(value.participants).toEqual(['Ana', 'Bruno']);
  });

  it('valida emails', () => {
    expect(isValidEmail('nome@empresa.com')).toBe(true);
    expect(isValidEmail('sem-arroba')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
  });
});

describe('progresso do preenchimento', () => {
  it('conta blocos com pelo menos uma nota', () => {
    expect(filledBlocks({ mercado: 2, problema: 0, geracao: 1 })).toBe(2);
    expect(progressPercent({ mercado: 2, geracao: 1, resultados: 1 })).toBe(33);
    expect(progressPercent({})).toBe(0);
  });
});
