// @vitest-environment node
import { Font, renderToBuffer } from '@react-pdf/renderer';
import { describe, expect, it, vi } from 'vitest';
import type { Note, Project } from '@/domain/types';
import { BLOCKS } from '@/methodology/agitar';

/**
 * Gera os documentos de verdade (sem navegador) para garantir que a
 * paginação e o ajuste de conteúdo se sustentam do caso vazio ao caso limite.
 */

// No navegador as fontes chegam por URL empacotada; aqui, pelos arquivos.
vi.mock('./theme', async (original) => {
  const actual = await original<typeof import('./theme')>();
  return { ...actual, registerFonts: () => undefined };
});

const fonts = 'node_modules/@fontsource';
Font.register({
  family: 'Inter',
  fonts: [400, 600, 700].map((weight) => ({
    src: `${fonts}/inter/files/inter-latin-${weight}-normal.woff`,
    fontWeight: weight,
  })),
});
Font.register({
  family: 'Source Serif',
  fonts: [{ src: `${fonts}/source-serif-4/files/source-serif-4-latin-600-normal.woff`, fontWeight: 600 }],
});
Font.registerHyphenationCallback((word) => [word]);

const now = new Date('2026-10-01T12:00:00Z').toISOString();

const project: Project = {
  id: 'projeto',
  name: 'Portal de atendimento ao cliente',
  description: 'Planejamento do novo produto.',
  organization: 'Prolinx Tecnologia',
  responsible: 'Presleyson Lima',
  participants: ['Ana Souza', 'Bruno Reis'],
  status: 'active',
  archivedAt: null,
  ownerId: 'usuario',
  createdAt: now,
  updatedAt: now,
  role: 'owner',
};

/** Todos os blocos no limite de notas, cada nota com o tamanho informado. */
function fullCanvas(length: number): Note[] {
  const text = 'Texto extenso para exercitar a paginação e o ajuste de fonte do documento. '.repeat(30).slice(0, length);
  return BLOCKS.flatMap((block) =>
    Array.from({ length: block.limit }, (_, index) => ({
      id: `${block.id}-${index}`,
      projectId: project.id,
      block: block.id,
      content: text,
      position: index + 1,
      version: 1,
      createdBy: null,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

function pageCount(pdf: Buffer): number {
  const match = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/.exec(pdf.toString('latin1'));
  return Number(match?.[1]);
}

const issuedAt = new Date(now);

describe('documentos PDF', () => {
  it.each([
    ['vazio', [] as Note[]],
    ['com notas curtas', fullCanvas(80)],
    ['com notas no tamanho máximo', fullCanvas(2000)],
  ])('relatório A4 %s é gerado e paginado', async (_label, notes) => {
    const { ReportA4 } = await import('./ReportA4');
    const pdf = await renderToBuffer(<ReportA4 project={project} notes={notes} issuedAt={issuedAt} />);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(notes.length > 0 ? 2 : 1);
  }, 30_000);

  it.each([
    ['A3', [] as Note[]],
    ['A3', fullCanvas(80)],
    ['A3', fullCanvas(2000)],
    ['A4', fullCanvas(80)],
    ['A4', fullCanvas(2000)],
  ] as const)('canvas %s ocupa sempre uma única página', async (size, notes) => {
    const { CanvasSheet } = await import('./CanvasSheet');
    const pdf = await renderToBuffer(<CanvasSheet project={project} notes={[...notes]} issuedAt={issuedAt} size={size} />);
    expect(pageCount(pdf)).toBe(1);
  }, 30_000);
});
