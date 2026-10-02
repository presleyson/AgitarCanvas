/**
 * Definição do modelo AGITAR Canvas.
 *
 * Fonte única da estrutura metodológica usada pela interface, pelas regras de
 * validação e pelos documentos de exportação. O conteúdo descritivo segue a
 * tese que originou o modelo:
 *
 * LIMA, Presleyson Plínio de. Modelo de gestão da inovação tecnológica para
 * pequenas e médias empresas de tecnologia da informação e comunicação. Tese
 * (Doutorado) — Universidade FUMEC, Belo Horizonte, 2024.
 *
 * - Ordem de preenchimento e orientação de cada bloco: capítulo 6, seção 6.3.
 * - Perguntas norteadoras: adaptadas do apêndice "Questionário".
 * - Acrônimo AGITAR: capítulo 5.
 *
 * Os limites de notas por bloco também são validados no banco de dados
 * (função `agitar_block_limit`). Ao alterar um limite aqui, crie uma migração
 * que atualize a função.
 */

export const METHODOLOGY_VERSION = 'agitar-canvas-2024';

export type BlockId =
  | 'planejamento'
  | 'problema'
  | 'mercado'
  | 'geracao'
  | 'selecionadas'
  | 'financeiros'
  | 'tecnicos'
  | 'parceiros'
  | 'resultados';

/**
 * Agrupamento visual dos blocos. É um recurso de interface para facilitar a
 * leitura do canvas e não faz parte da formulação original do modelo.
 */
export type BlockGroup = 'estrategia' | 'contexto' | 'ideias' | 'recursos';

export interface GuidingQuestion {
  text: string;
  /** Citação no formato autor e ano, conforme a tese. */
  source: string;
}

export interface BlockDefinition {
  id: BlockId;
  /** Posição na ordem de preenchimento recomendada (1 a 9). */
  step: number;
  title: string;
  shortTitle: string;
  group: BlockGroup;
  /** Número máximo de notas no bloco. */
  limit: number;
  /** Texto exibido quando o bloco está vazio. */
  placeholder: string;
  /** Orientação metodológica resumida. */
  guidance: string;
  questions: GuidingQuestion[];
}

export const GROUPS: Record<BlockGroup, { label: string }> = {
  estrategia: { label: 'Estratégia' },
  contexto: { label: 'Contexto' },
  ideias: { label: 'Ideias' },
  recursos: { label: 'Recursos e parcerias' },
};

export const BLOCKS: readonly BlockDefinition[] = [
  {
    id: 'planejamento',
    step: 1,
    title: 'Planejamento Estratégico',
    shortTitle: 'Planejamento',
    group: 'estrategia',
    limit: 6,
    placeholder:
      'Defina os objetivos de longo prazo, as estratégias para alcançá-los e as métricas de sucesso. Destaque metas, prazos e ações-chave.',
    guidance:
      'Primeira etapa do modelo. O planejamento estratégico funciona como a espinha dorsal do projeto: define objetivos de longo prazo, estratégias e métricas de sucesso, de modo que as atividades seguintes permaneçam alinhadas à visão da empresa.',
    questions: [
      {
        text: 'Como a empresa alinha o desenvolvimento de novos produtos com a sua estratégia geral?',
        source: 'Khurana e Rosenthal, 1998',
      },
      {
        text: 'Como a empresa identifica oportunidades de inovação por meio de diversas fontes, incluindo clientes, concorrentes, fornecedores, funcionários e parceiros?',
        source: 'Cooper, 1993',
      },
    ],
  },
  {
    id: 'problema',
    step: 2,
    title: 'Problema',
    shortTitle: 'Problema',
    group: 'contexto',
    limit: 2,
    placeholder:
      'Identifique os principais problemas que sua empresa busca resolver. Explique como esses problemas afetam os clientes ou o mercado.',
    guidance:
      'A articulação do problema define o escopo do projeto e mantém a equipe concentrada em questões relevantes. Uma definição clara também facilita a comunicação com partes interessadas e potenciais investidores.',
    questions: [
      {
        text: 'Como a empresa define os problemas que deseja resolver?',
        source: 'Clark e Wheelwright, 1993',
      },
      {
        text: 'Quais são os critérios utilizados pela empresa para identificar e priorizar problemas que sejam relevantes para seus objetivos estratégicos?',
        source: 'Rothwell, 1992',
      },
    ],
  },
  {
    id: 'mercado',
    step: 3,
    title: 'Mercado',
    shortTitle: 'Mercado',
    group: 'contexto',
    limit: 2,
    placeholder: 'Insira aqui o mercado alvo.',
    guidance:
      'A identificação do mercado alvo determina onde a empresa concentrará seus esforços de inovação e orienta o desenvolvimento de soluções que atendam a necessidades reais e sejam viáveis comercialmente.',
    questions: [
      {
        text: 'Como as empresas podem identificar e capturar oportunidades de mercado emergentes em um ambiente tecnológico em rápida evolução?',
        source: 'Levy, 1998',
      },
      {
        text: 'Quais elementos a empresa deve incorporar em sua cultura organizacional para criar um ambiente propício à inovação e ao desenvolvimento de novos produtos e serviços?',
        source: 'Pugh, 1991',
      },
    ],
  },
  {
    id: 'geracao',
    step: 4,
    title: 'Geração de Ideias',
    shortTitle: 'Geração de ideias',
    group: 'ideias',
    limit: 5,
    placeholder: 'Insira aqui ideias vindas de pesquisas de mercado, brainstorming, etc.',
    guidance:
      'Espaço colaborativo para registrar informações obtidas em pesquisas de mercado, sessões de brainstorming e outras técnicas. O repositório de ideias permite explorar possibilidades antes de assumir uma direção específica.',
    questions: [
      {
        text: 'Como a empresa identifica oportunidades de inovação?',
        source: 'Cooper e Edgett, 2008',
      },
      {
        text: 'Quais são as principais origens das ideias que conduzem ao desenvolvimento de novos produtos?',
        source: 'Coral, Ogliari e Abreu, 2008',
      },
    ],
  },
  {
    id: 'selecionadas',
    step: 5,
    title: 'Ideias Selecionadas',
    shortTitle: 'Ideias selecionadas',
    group: 'ideias',
    limit: 5,
    placeholder: 'Liste aqui as ideias selecionadas mais viáveis.',
    guidance:
      'Destaque as soluções mais viáveis e promissoras identificadas na geração de ideias. A seleção se apoia nos critérios definidos no planejamento estratégico, para que as ideias escolhidas estejam alinhadas aos objetivos e às capacidades da empresa.',
    questions: [
      {
        text: 'Como a empresa avalia a qualidade das ideias?',
        source: 'Coral, Ogliari e Abreu, 2008',
      },
      {
        text: 'Como a empresa garante que as ideias selecionadas sejam inovadoras e tenham potencial de sucesso?',
        source: 'Jonash e Sommerlatte, 2001',
      },
    ],
  },
  {
    id: 'financeiros',
    step: 6,
    title: 'Recursos Financeiros',
    shortTitle: 'Recursos financeiros',
    group: 'recursos',
    limit: 5,
    placeholder:
      'Enumere potenciais fontes de financiamento, como investidores privados, capital de risco, subsídios governamentais, etc.',
    guidance:
      'Mapeie as potenciais fontes de financiamento, como investidores privados, capital de risco e subsídios governamentais, para assegurar que o projeto disponha dos recursos necessários da concepção à implementação.',
    questions: [
      {
        text: 'Como a empresa utiliza fontes de financiamento externas para apoiar a inovação tecnológica?',
        source: 'Clark e Wheelwright, 1992',
      },
      {
        text: 'Como a empresa avalia se as suas parcerias com investidores privados, capital de risco ou governos estão contribuindo para a inovação?',
        source: 'Docherty, 2006',
      },
    ],
  },
  {
    id: 'tecnicos',
    step: 7,
    title: 'Recursos Técnicos',
    shortTitle: 'Recursos técnicos',
    group: 'recursos',
    limit: 5,
    placeholder:
      'Liste as instituições ou organizações que podem fornecer suporte técnico, como universidades, parques tecnológicos, ou fornecedores.',
    guidance:
      'Registre as instituições capazes de oferecer suporte técnico ao projeto, como universidades, parques tecnológicos e fornecedores de tecnologia, que contribuam com conhecimento especializado e recursos técnicos.',
    questions: [
      {
        text: 'Como a empresa se relaciona com organizações que podem fornecer suporte técnico, como universidades, parques tecnológicos ou fornecedores?',
        source: 'Jonash e Sommerlatte, 2001',
      },
      {
        text: 'Quais são as principais vantagens e desvantagens de se relacionar com organizações que podem fornecer suporte técnico?',
        source: 'Hansen e Birkinshaw, 2007',
      },
    ],
  },
  {
    id: 'parceiros',
    step: 8,
    title: 'Principais Parceiros',
    shortTitle: 'Parceiros',
    group: 'recursos',
    limit: 5,
    placeholder: 'Identifique os principais colaboradores, agentes, departamentos ou sócios.',
    guidance:
      'Identifique colaboradores, agentes de inovação, departamentos ou sócios que terão papel decisivo no projeto. Uma rede consistente de parceiros amplia o acesso a recursos, conhecimento e mercados.',
    questions: [
      {
        text: 'Quais são as principais organizações com que a empresa colabora para obter suporte técnico?',
        source: 'Coral, Ogliari e Abreu, 2008',
      },
    ],
  },
  {
    id: 'resultados',
    step: 9,
    title: 'Resultados',
    shortTitle: 'Resultados',
    group: 'estrategia',
    limit: 6,
    placeholder: 'Apresente os resultados ou objetivos que sua empresa espera alcançar.',
    guidance:
      'Defina os resultados esperados, que podem abranger inovações de produtos, serviços e processos, ganhos de eficiência e expansão de mercado. Resultados claros orientam as atividades e servem de base para avaliar o sucesso do projeto ao longo do tempo.',
    questions: [
      {
        text: 'Como a empresa avalia os resultados da sua gestão da inovação tecnológica?',
        source: 'Brockhoff, 1994',
      },
    ],
  },
];

export const BLOCK_IDS: readonly BlockId[] = BLOCKS.map((b) => b.id);

const BY_ID = Object.fromEntries(BLOCKS.map((b) => [b.id, b])) as Record<BlockId, BlockDefinition>;

export function getBlock(id: BlockId): BlockDefinition {
  return BY_ID[id];
}

export function isBlockId(value: unknown): value is BlockId {
  return typeof value === 'string' && value in BY_ID;
}

/** Blocos na ordem de preenchimento recomendada pela metodologia. */
export const BLOCKS_BY_STEP: readonly BlockDefinition[] = [...BLOCKS].sort((a, b) => a.step - b.step);

/**
 * Disposição espacial do canvas em telas largas, conforme a figura do
 * framework na tese: cinco colunas à esquerda, Mercado e Problema empilhados à
 * direita, Resultados e Planejamento Estratégico na base.
 */
export const CANVAS_LAYOUT = {
  columns: ['parceiros', 'tecnicos', 'financeiros', 'selecionadas', 'geracao'] as BlockId[],
  side: ['mercado', 'problema'] as BlockId[],
  base: ['resultados', 'planejamento'] as BlockId[],
};

export const ACRONYM: readonly { letter: string; title: string; text: string }[] = [
  {
    letter: 'A',
    title: 'Avaliação constante',
    text: 'Avaliação contínua das necessidades dos clientes e do mercado, de modo a identificar oportunidades de inovação.',
  },
  {
    letter: 'G',
    title: 'Geração de ideias',
    text: 'Geração de ideias inovadoras, com incentivo à colaboração e à criatividade da equipe.',
  },
  {
    letter: 'I',
    title: 'Implementação ágil',
    text: 'Implementação ágil e eficiente dos projetos de inovação, para que as ideias se tornem soluções práticas.',
  },
  {
    letter: 'T',
    title: 'Testes e validação',
    text: 'Teste e validação das novas soluções em ambiente controlado antes do lançamento, reduzindo riscos.',
  },
  {
    letter: 'A',
    title: 'Acompanhamento contínuo',
    text: 'Acompanhamento do desempenho e do retorno de clientes e partes interessadas, para refinamento e melhoria contínua.',
  },
  {
    letter: 'R',
    title: 'Realinhamento constante',
    text: 'Realinhamento da gestão da inovação para acompanhar as mudanças do mercado e as evoluções tecnológicas.',
  },
];

export const THESIS_REFERENCE =
  'LIMA, Presleyson Plínio de. Modelo de gestão da inovação tecnológica para pequenas e médias empresas de tecnologia da informação e comunicação. Tese (Doutorado em Tecnologia da Informação e Comunicação e Gestão do Conhecimento) — Universidade FUMEC, Belo Horizonte, 2024.';

/** Obras citadas nas perguntas norteadoras, conforme a lista de referências da tese. */
export const REFERENCES: readonly string[] = [
  'BROCKHOFF, K. Forschung und Entwicklung: Planung und Kontrolle. München; Wien: Oldenbourg Verlag, 1994.',
  'CLARK, K. B.; WHEELWRIGHT, S. C. Structuring the development funnel. New York: Free Press, 1992. cap. 5, p. 111–132.',
  'CLARK, K. B.; WHEELWRIGHT, S. C. Managing new product and process development: text and cases. New York: Free Press, 1993.',
  'COOPER, R. G. Winning at new products: accelerating the process from idea to launch. Reading: Addison-Wesley, 1993.',
  'COOPER, R. G.; EDGETT, S. J. Maximizing productivity in product innovation. Research Technology Management, v. 51, n. 2, p. 47–58, 2008.',
  'CORAL, E.; OGLIARI, A.; ABREU, A. F. de. Visão geral da metodologia NUGIN. São Paulo: Atlas, 2008.',
  'DOCHERTY, M. Primer on "open innovation": principles and practice. Visions, v. 30, n. 2, p. 13–15, 2006.',
  'HANSEN, M. T.; BIRKINSHAW, J. The innovation value chain. Harvard Business Review, v. 85, n. 6, p. 121–130, 2007.',
  'JONASH, R. S.; SOMMERLATTE, T. O valor da inovação: como as empresas mais avançadas atingem alto desempenho e lucratividade. Rio de Janeiro: Campus, 2001.',
  'KHURANA, A.; ROSENTHAL, S. R. Towards holistic "front ends" in new product development. Journal of Product Innovation Management, v. 15, n. 1, p. 57–74, 1998.',
  'LEVY, N. S. Managing high technology and innovation. New Jersey: Pearson Education, 1998.',
  'PUGH, S. Total design: integrated methods for successful product engineering. Harlow: Addison Wesley, 1991.',
  'ROTHWELL, R. Successful industrial innovation: critical factors for the 1990s. R&D Management, v. 22, n. 3, p. 221–240, 1992.',
];
