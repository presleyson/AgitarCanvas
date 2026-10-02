import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { STATUS_LABEL } from '@/domain/types';
import { formatDateTime, formatLongDate } from '@/lib/dates';
import { BLOCKS_BY_STEP, CANVAS_LAYOUT, GROUPS, getBlock, type BlockId } from '@/methodology/agitar';
import { notesByBlock, type ExportData } from './data';
import { COLORS, GROUP_COLORS, INSTITUTIONAL_FOOTER } from './theme';

/**
 * Relatório A4 (retrato): identificação do projeto, visão geral do canvas e o
 * conteúdo de cada dimensão, na ordem de preenchimento da metodologia. O
 * conteúdo flui por quantas páginas forem necessárias, com rodapé e paginação.
 */

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 54,
    paddingHorizontal: 44,
    fontFamily: 'Inter',
    fontSize: 9.5,
    color: COLORS.text,
    // A altura de linha é definida em cada estilo de texto. Declarada aqui,
    // ela é herdada pelo rodapé paginado e desestabiliza o cálculo de quebra
    // de página em documentos longos.
  },
  brand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: -44,
    marginTop: -44,
    paddingHorizontal: 44,
    paddingVertical: 14,
    backgroundColor: COLORS.ink,
    color: '#ffffff',
  },
  brandName: { fontSize: 10, fontWeight: 700, letterSpacing: 1.2 },
  brandDoc: { fontSize: 8.5, opacity: 0.8 },
  title: { marginTop: 26, fontFamily: 'Source Serif', fontWeight: 600, fontSize: 24, lineHeight: 1.2 },
  organization: { marginTop: 4, fontSize: 12, color: COLORS.muted },
  description: { marginTop: 12, fontSize: 10, lineHeight: 1.5, color: '#454a61' },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  metaItem: { width: '33.33%', paddingRight: 10, marginBottom: 8 },
  metaWide: { width: '100%', paddingRight: 10 },
  metaLabel: { fontSize: 7, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: COLORS.subtle },
  metaValue: { marginTop: 2, fontSize: 10, lineHeight: 1.35 },
  sectionTitle: {
    marginTop: 22,
    marginBottom: 8,
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
  },
  overview: { flexDirection: 'row', height: 132 },
  overviewColumn: { flex: 1, marginRight: 3 },
  overviewBase: { flexDirection: 'row', height: 44, marginTop: 3 },
  cell: {
    flex: 1,
    padding: 5,
    borderRadius: 3,
    borderTopWidth: 2.5,
    justifyContent: 'space-between',
  },
  cellName: { fontSize: 7, fontWeight: 600, lineHeight: 1.2 },
  cellCount: { fontSize: 7, color: COLORS.muted },
  block: { marginTop: 16 },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 6,
    borderBottomWidth: 1.5,
  },
  step: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginRight: 8,
    textAlign: 'center',
    fontSize: 9,
    fontWeight: 700,
    paddingTop: 2.5,
  },
  blockTitle: { flex: 1, fontFamily: 'Source Serif', fontWeight: 600, fontSize: 14 },
  blockGroup: { marginTop: 4, fontSize: 7.5, color: COLORS.subtle, letterSpacing: 0.6, textTransform: 'uppercase' },
  guidance: { marginTop: 6, fontSize: 8.5, lineHeight: 1.45, color: COLORS.muted },
  note: {
    flexDirection: 'row',
    marginTop: 6,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderRadius: 3,
    borderLeftWidth: 2.5,
    backgroundColor: COLORS.sunken,
  },
  noteIndex: { width: 16, fontSize: 8.5, fontWeight: 700, color: COLORS.muted },
  noteText: { flex: 1, fontSize: 10, lineHeight: 1.45 },
  empty: { marginTop: 6, fontSize: 9, color: COLORS.subtle },
  footer: {
    position: 'absolute',
    left: 44,
    right: 44,
    bottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 7,
    borderTopWidth: 0.75,
    borderColor: COLORS.border,
    fontSize: 7,
    color: COLORS.subtle,
  },
});

function OverviewCell({ id, count }: { id: BlockId; count: number }) {
  const block = getBlock(id);
  const colors = GROUP_COLORS[block.group];
  return (
    <View style={[styles.cell, { borderTopColor: colors.main, backgroundColor: count > 0 ? colors.soft : COLORS.sunken }]}>
      <Text style={styles.cellName}>
        {block.step}. {block.shortTitle}
      </Text>
      <Text style={styles.cellCount}>
        {count} {count === 1 ? 'nota' : 'notas'}
      </Text>
    </View>
  );
}

function NoteRow({ index, text, color }: { index: number; text: string; color: string }) {
  return (
    <View style={[styles.note, { borderLeftColor: color }]} wrap={false}>
      <Text style={styles.noteIndex}>{index}</Text>
      <Text style={styles.noteText}>{text.trim()}</Text>
    </View>
  );
}

export function ReportA4({ project, notes, issuedAt }: ExportData) {
  const grouped = notesByBlock(notes);
  const count = (id: BlockId) => grouped[id].length;

  return (
    <Document
      title={`${project.name} · Relatório AGITAR Canvas`}
      author={project.responsible || project.organization || 'AGITAR Canvas'}
      subject="Planejamento de gestão da inovação tecnológica"
      creator="AGITAR Canvas"
      producer="AGITAR Canvas"
      language="pt-BR"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.brand}>
          <Text style={styles.brandName}>AGITAR CANVAS</Text>
          <Text style={styles.brandDoc}>Relatório do planejamento</Text>
        </View>

        <Text style={styles.title}>{project.name}</Text>
        {project.organization ? <Text style={styles.organization}>{project.organization}</Text> : null}
        {project.description ? <Text style={styles.description}>{project.description}</Text> : null}

        <View style={styles.meta}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Responsável</Text>
            <Text style={styles.metaValue}>{project.responsible || 'Não informado'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={styles.metaValue}>{STATUS_LABEL[project.status]}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Data de emissão</Text>
            <Text style={styles.metaValue}>{formatLongDate(issuedAt)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Organização</Text>
            <Text style={styles.metaValue}>{project.organization || 'Não informada'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Criado em</Text>
            <Text style={styles.metaValue}>{formatLongDate(project.createdAt)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Última atualização</Text>
            <Text style={styles.metaValue}>{formatDateTime(project.updatedAt)}</Text>
          </View>
          <View style={styles.metaWide}>
            <Text style={styles.metaLabel}>Participantes</Text>
            <Text style={styles.metaValue}>
              {project.participants.length > 0 ? project.participants.join(', ') : 'Não informados'}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Visão geral do canvas</Text>
        <View wrap={false}>
          <View style={styles.overview}>
            {CANVAS_LAYOUT.columns.map((id) => (
              <View key={id} style={styles.overviewColumn}>
                <OverviewCell id={id} count={count(id)} />
              </View>
            ))}
            <View style={{ flex: 1.15 }}>
              <OverviewCell id="mercado" count={count('mercado')} />
              <View style={{ height: 3 }} />
              <OverviewCell id="problema" count={count('problema')} />
            </View>
          </View>
          <View style={styles.overviewBase}>
            <View style={{ flex: 1, marginRight: 3 }}>
              <OverviewCell id="resultados" count={count('resultados')} />
            </View>
            <OverviewCell id="planejamento" count={count('planejamento')} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Dimensões do planejamento</Text>
        {BLOCKS_BY_STEP.map((block) => {
          const colors = GROUP_COLORS[block.group];
          const [first, ...rest] = grouped[block.id];
          return (
            <View key={block.id} style={styles.block}>
              {/* O cabeçalho segue junto da primeira nota: nunca fica sozinho no fim da página. */}
              <View wrap={false}>
                <View style={[styles.blockHeader, { borderBottomColor: colors.main }]}>
                  <Text style={[styles.step, { backgroundColor: colors.soft, color: colors.ink }]}>{block.step}</Text>
                  <Text style={styles.blockTitle}>{block.title}</Text>
                  <Text style={styles.blockGroup}>{GROUPS[block.group].label}</Text>
                </View>
                <Text style={styles.guidance}>{block.guidance}</Text>
                {first ? (
                  <NoteRow index={1} text={first.content} color={colors.main} />
                ) : (
                  <Text style={styles.empty}>Sem registros nesta dimensão.</Text>
                )}
              </View>
              {rest.map((note, index) => (
                <NoteRow key={note.id} index={index + 2} text={note.content} color={colors.main} />
              ))}
            </View>
          );
        })}

        <View style={styles.footer} fixed>
          <Text>{INSTITUTIONAL_FOOTER}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
