import { useState } from 'react';
import { Download, FileText, LayoutDashboard, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import type { Note, Project } from '@/domain/types';
import { EXPORT_LABEL, buildPdf, downloadBlob, exportFileName, printBlob, type ExportKind } from './exportPdf';

interface ExportMenuProps {
  project: Project;
  notes: Note[];
  /** Garante que o conteúdo exportado inclua as últimas edições. */
  beforeExport?: () => Promise<void>;
  compact?: boolean;
}

/** Exportação em PDF e impressão, em A4 (relatório) e A3 (canvas em página única). */
export function ExportMenu({ project, notes, beforeExport, compact }: ExportMenuProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run(kind: ExportKind, target: 'download' | 'print') {
    setBusy(true);
    try {
      await beforeExport?.();
      const blob = await buildPdf(kind, project, notes);
      if (target === 'download') {
        downloadBlob(blob, exportFileName(project, kind));
        toast({ message: `${EXPORT_LABEL[kind]} exportado em PDF.`, tone: 'success' });
      } else {
        printBlob(blob);
        if (kind === 'canvas-a3') {
          toast({ message: 'No diálogo de impressão, selecione papel A3 e orientação paisagem.', tone: 'info', durationMs: 8000 });
        }
      }
    } catch {
      toast({ message: 'Não foi possível gerar o documento. Tente novamente.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Menu
      trigger={
        <Button icon={<Download size={16} aria-hidden />} loading={busy} aria-label="Exportar e imprimir">
          {compact ? undefined : 'Exportar'}
        </Button>
      }
      items={[
        { type: 'label', label: 'Exportar em PDF' },
        { label: 'Relatório A4', hint: 'retrato', icon: <FileText size={16} aria-hidden />, onSelect: () => void run('report-a4', 'download') },
        { label: 'Canvas A3', hint: 'página única', icon: <LayoutDashboard size={16} aria-hidden />, onSelect: () => void run('canvas-a3', 'download') },
        { label: 'Canvas A4', hint: 'paisagem', icon: <LayoutDashboard size={16} aria-hidden />, onSelect: () => void run('canvas-a4', 'download') },
        { type: 'separator' },
        { type: 'label', label: 'Imprimir' },
        { label: 'Relatório em A4', icon: <Printer size={16} aria-hidden />, onSelect: () => void run('report-a4', 'print') },
        { label: 'Canvas em A3', icon: <Printer size={16} aria-hidden />, onSelect: () => void run('canvas-a3', 'print') },
      ]}
    />
  );
}
