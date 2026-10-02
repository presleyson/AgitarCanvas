import { createElement } from 'react';
import type { Note, Project } from '@/domain/types';

export type ExportKind = 'report-a4' | 'canvas-a3' | 'canvas-a4';

export const EXPORT_LABEL: Record<ExportKind, string> = {
  'report-a4': 'Relatório A4',
  'canvas-a3': 'Canvas A3',
  'canvas-a4': 'Canvas A4 paisagem',
};

function slug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'projeto'
  );
}

export function exportFileName(project: Project, kind: ExportKind): string {
  return `agitar-canvas_${slug(project.name)}_${kind}.pdf`;
}

/**
 * Gera o PDF no navegador. O gerador é carregado sob demanda, para não pesar
 * no carregamento inicial da aplicação.
 */
export async function buildPdf(kind: ExportKind, project: Project, notes: Note[]): Promise<Blob> {
  const [{ pdf }, theme, report, canvas] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./pdf/theme'),
    import('./pdf/ReportA4'),
    import('./pdf/CanvasSheet'),
  ]);
  theme.registerFonts();

  const data = { project, notes, issuedAt: new Date() };
  const document =
    kind === 'report-a4'
      ? createElement(report.ReportA4, data)
      : createElement(canvas.CanvasSheet, { ...data, size: kind === 'canvas-a3' ? 'A3' : 'A4' });

  // O tipo exigido por pdf() é o elemento <Document>; os componentes acima o devolvem.
  return pdf(document as Parameters<typeof pdf>[0]).toBlob();
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function isTouchDevice(): boolean {
  return /iPad|iPhone|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
}

/**
 * Envia o PDF para impressão. Em computadores, abre o diálogo de impressão
 * sobre a própria página. Em celulares e tablets, onde a impressão a partir de
 * quadros ocultos não é confiável, abre o documento em nova aba para que o
 * usuário imprima pelo visualizador do sistema.
 */
export function printBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);

  if (isTouchDevice()) {
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    return;
  }

  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.setAttribute('aria-hidden', 'true');
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  };
  document.body.appendChild(frame);

  // O quadro é mantido enquanto o diálogo de impressão pode estar aberto.
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 10 * 60_000);
}
