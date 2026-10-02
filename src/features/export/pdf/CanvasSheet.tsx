import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { STATUS_LABEL } from '@/domain/types';
import { formatLongDate } from '@/lib/dates';
import { CANVAS_LAYOUT, getBlock, type BlockId } from '@/methodology/agitar';
import { notesByBlock, type ExportData } from './data';
import { NOTE_GAP, NOTE_PADDING_X, NOTE_PADDING_Y, fitCanvas, type BlockBox } from './fit';
import { COLORS, GROUP_COLORS, INSTITUTIONAL_FOOTER } from './theme';

/**
 * Canvas em página única (A3 ou A4, paisagem), na disposição do modelo. É o
 * documento para reuniões e workshops: todas as dimensões lado a lado.
 */

type SheetSize = 'A3' | 'A4';

interface Metrics {
  width: number;
  height: number;
  margin: number;
  gap: number;
  headerHeight: number;
  footerHeight: number;
  blockHeader: number;
  blockPadding: number;
  titleSize: number;
  baseColumns: number;
  fontSizes: number[];
  scale: number;
}

const METRICS: Record<SheetSize, Metrics> = {
  A3: {
    width: 1190.55,
    height: 841.89,
    margin: 34,
    gap: 7,
    headerHeight: 74,
    footerHeight: 22,
    blockHeader: 30,
    blockPadding: 9,
    titleSize: 11.5,
    baseColumns: 3,
    fontSizes: [11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5, 7],
    scale: 1,
  },
  A4: {
    width: 841.89,
    height: 595.28,
    margin: 24,
    gap: 5,
    headerHeight: 54,
    footerHeight: 18,
    blockHeader: 22,
    blockPadding: 6,
    titleSize: 8,
    baseColumns: 3,
    fontSizes: [8.5, 8, 7.5, 7, 6.5, 6, 5.5],
    scale: 0.72,
  },
};

const BORDER = 0.75;
const SIDE_RATIO = 1.15;
const BASE_SHARE = 0.25;

interface Layout {
  columnWidth: number;
  sideWidth: number;
  topHeight: number;
  sideBlockHeight: number;
  baseHeight: number;
  baseWidth: number;
}

function computeLayout(metrics: Metrics): Layout {
  const innerWidth = metrics.width - metrics.margin * 2;
  const innerHeight =
    metrics.height - metrics.margin * 2 - metrics.headerHeight - metrics.footerHeight - metrics.gap * 2;
  const unit = (innerWidth - metrics.gap * 5) / (5 + SIDE_RATIO);
  const baseHeight = Math.round(innerHeight * BASE_SHARE);
  const topHeight = innerHeight - baseHeight - metrics.gap;
  return {
    columnWidth: unit,
    sideWidth: unit * SIDE_RATIO,
    topHeight,
    sideBlockHeight: (topHeight - metrics.gap) / 2,
    baseHeight,
    baseWidth: (innerWidth - metrics.gap) / 2,
  };
}

const ORDER: BlockId[] = [...CANVAS_LAYOUT.columns, ...CANVAS_LAYOUT.side, ...CANVAS_LAYOUT.base];

const styles = StyleSheet.create({
  page: { fontFamily: 'Inter', color: COLORS.text },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  brand: { fontWeight: 700, letterSpacing: 1.2, color: COLORS.primary },
  title: { fontFamily: 'Source Serif', fontWeight: 600, lineHeight: 1.15 },
  metaRow: { flexDirection: 'row' },
  metaItem: { alignItems: 'flex-end' },
  metaLabel: { fontWeight: 600, letterSpacing: 0.7, textTransform: 'uppercase', color: COLORS.subtle },
  block: {
    borderWidth: BORDER,
    borderColor: COLORS.border,
    borderRadius: 4,
    backgroundColor: COLORS.surface,
    overflow: 'hidden',
  },
  blockHeader: { flexDirection: 'row', alignItems: 'center' },
  step: { textAlign: 'center', fontWeight: 700 },
  blockTitle: { flex: 1, fontWeight: 700 },
  notes: { flexDirection: 'row' },
  note: {
    borderWidth: 0.5,
    borderColor: COLORS.noteBorder,
    borderRadius: 2.5,
    backgroundColor: COLORS.note,
    paddingVertical: NOTE_PADDING_Y,
    paddingHorizontal: NOTE_PADDING_X,
    marginBottom: NOTE_GAP,
    lineHeight: 1.32,
  },
  empty: { color: COLORS.subtle },
  footer: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: COLORS.subtle,
  },
});

interface BlockProps {
  id: BlockId;
  width: number;
  height: number;
  columns: number;
  notes: string[];
  fontSize: number;
  metrics: Metrics;
}

function Block({ id, width, height, columns, notes, fontSize, metrics }: BlockProps) {
  const block = getBlock(id);
  const colors = GROUP_COLORS[block.group];
  const stepSize = metrics.titleSize + 6;
  const innerWidth = width - metrics.blockPadding * 2 - BORDER * 2;
  const columnWidth = (innerWidth - NOTE_GAP * (columns - 1)) / columns;

  const byColumn: string[][] = Array.from({ length: columns }, () => []);
  notes.forEach((note, index) => byColumn[index % columns].push(note));

  return (
    <View style={[styles.block, { width, height, borderTopWidth: 3, borderTopColor: colors.main }]}>
      <View style={[styles.blockHeader, { height: metrics.blockHeader, paddingHorizontal: metrics.blockPadding }]}>
        <Text
          style={[
            styles.step,
            {
              width: stepSize,
              height: stepSize,
              borderRadius: stepSize / 2,
              marginRight: 5,
              paddingTop: stepSize * 0.17,
              fontSize: metrics.titleSize - 2.5,
              backgroundColor: colors.soft,
              color: colors.ink,
            },
          ]}
        >
          {block.step}
        </Text>
        <Text style={[styles.blockTitle, { fontSize: metrics.titleSize }]}>{block.title}</Text>
      </View>

      <View style={[styles.notes, { paddingHorizontal: metrics.blockPadding }]}>
        {notes.length === 0 ? (
          <Text style={[styles.empty, { fontSize: Math.max(5.5, fontSize - 1.5) }]}>Sem registros.</Text>
        ) : (
          byColumn.map((column, index) => (
            <View key={index} style={{ width: columnWidth, marginRight: index < columns - 1 ? NOTE_GAP : 0 }}>
              {column.map((note, noteIndex) => (
                <Text key={noteIndex} style={[styles.note, { fontSize }]}>
                  {note}
                </Text>
              ))}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

export function CanvasSheet({ project, notes, issuedAt, size }: ExportData & { size: SheetSize }) {
  const metrics = METRICS[size];
  const layout = computeLayout(metrics);
  const grouped = notesByBlock(notes);

  const dimensions = (id: BlockId): { width: number; height: number; columns: number } => {
    if (CANVAS_LAYOUT.side.includes(id)) return { width: layout.sideWidth, height: layout.sideBlockHeight, columns: 1 };
    if (CANVAS_LAYOUT.base.includes(id)) {
      return { width: layout.baseWidth, height: layout.baseHeight, columns: metrics.baseColumns };
    }
    return { width: layout.columnWidth, height: layout.topHeight, columns: 1 };
  };

  const boxes: BlockBox[] = ORDER.map((id) => {
    const { width, height, columns } = dimensions(id);
    return {
      width: width - metrics.blockPadding * 2 - BORDER * 2,
      height: height - metrics.blockHeader - metrics.blockPadding - 3 - BORDER,
      columns,
      notes: grouped[id].map((note) => note.content.trim()),
    };
  });
  const fitted = fitCanvas(boxes, metrics.fontSizes);
  const notesFor = (id: BlockId) => fitted.notes[ORDER.indexOf(id)];

  const render = (id: BlockId) => (
    <Block key={id} id={id} {...dimensions(id)} notes={notesFor(id)} fontSize={fitted.fontSize} metrics={metrics} />
  );

  const s = metrics.scale;
  const meta: Array<[string, string]> = [
    ['Organização', project.organization || 'Não informada'],
    ['Responsável', project.responsible || 'Não informado'],
    ['Status', STATUS_LABEL[project.status]],
    ['Data', formatLongDate(issuedAt)],
  ];

  return (
    <Document
      title={`${project.name} · AGITAR Canvas ${size}`}
      author={project.responsible || project.organization || 'AGITAR Canvas'}
      subject="Canvas de gestão da inovação tecnológica"
      creator="AGITAR Canvas"
      producer="AGITAR Canvas"
      language="pt-BR"
    >
      <Page size={size} orientation="landscape" style={[styles.page, { padding: metrics.margin }]}>
        <View style={[styles.header, { height: metrics.headerHeight, paddingBottom: 12 * s }]}>
          <View style={{ flex: 1, paddingRight: 24 * s }}>
            <Text style={[styles.brand, { fontSize: 9 * s + 1 }]}>AGITAR CANVAS</Text>
            <Text style={[styles.title, { fontSize: 24 * s + 2, marginTop: 3 * s }]}>{project.name}</Text>
          </View>
          <View style={styles.metaRow}>
            {meta.map(([label, value]) => (
              <View key={label} style={[styles.metaItem, { marginLeft: 26 * s, maxWidth: 220 * s }]}>
                <Text style={[styles.metaLabel, { fontSize: 6.5 * s + 1 }]}>{label}</Text>
                <Text style={{ fontSize: 10 * s + 1, marginTop: 2 }}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ flexDirection: 'row', height: layout.topHeight }}>
          {CANVAS_LAYOUT.columns.map((id) => (
            <View key={id} style={{ marginRight: metrics.gap }}>
              {render(id)}
            </View>
          ))}
          <View>
            {render('mercado')}
            <View style={{ height: metrics.gap }} />
            {render('problema')}
          </View>
        </View>

        <View style={{ flexDirection: 'row', marginTop: metrics.gap }}>
          <View style={{ marginRight: metrics.gap }}>{render('resultados')}</View>
          {render('planejamento')}
        </View>

        <View
          style={[
            styles.footer,
            { left: metrics.margin, right: metrics.margin, bottom: metrics.margin - 4, fontSize: 6.5 * s + 1 },
          ]}
        >
          <Text>
            {INSTITUTIONAL_FOOTER}
            {project.participants.length > 0 ? ` · Participantes: ${project.participants.join(', ')}` : ''}
          </Text>
          {fitted.truncated && <Text>Textos abreviados para caber na página. Conteúdo completo no relatório A4.</Text>}
        </View>
      </Page>
    </Document>
  );
}
