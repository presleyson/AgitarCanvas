// Fonte única da estrutura do canvas: título, posição, limite de post-its e texto de orientação.
// Qualquer outro módulo deve derivar seus dados daqui, evitando divergências de grafia.
export const sections = [
  { title: 'Principais Parceiros', area: 'left', limit: 5, slug: 'principais-parceiros', text: 'Identifique os principais colaboradores, agentes, departamentos ou sócios.' },
  { title: 'Recursos Técnicos', area: 'left', limit: 5, slug: 'recursos-tecnicos', text: 'Liste as instituições ou organizações que podem fornecer suporte técnico, como universidades, parques tecnológicos, ou fornecedores.' },
  { title: 'Recursos Financeiros', area: 'left', limit: 5, slug: 'recursos-financeiros', text: 'Enumere potenciais fontes de financiamento, como investidores privados, capital de risco, subsídios governamentais, etc.' },
  { title: 'Ideias Selecionadas', area: 'left', limit: 5, slug: 'ideias-selecionadas', text: 'Liste aqui as ideias selecionadas mais viáveis.' },
  { title: 'Geração de ideias', area: 'left', limit: 5, slug: 'geracao-ideias', text: 'Insira aqui ideias vindas de pesquisas de mercado, brainstorming, etc.' },
  { title: 'Mercado', area: 'right', limit: 2, slug: 'mercado', text: 'Insira aqui o mercado alvo.' },
  { title: 'Problema', area: 'right', limit: 2, slug: 'problema', text: 'Identifique os principais problemas que sua empresa busca resolver. Explique como esses problemas afetam os clientes ou o mercado.' },
  { title: 'Resultados', area: 'bottom', limit: 6, slug: 'resultados', text: 'Apresente os resultados ou objetivos que sua empresa espera alcançar.' },
  { title: 'Planejamento Estratégico', area: 'bottom', limit: 6, slug: 'planejamento-estrategico', text: 'Apresente os resultados ou objetivos que sua empresa espera alcançar. Destaque metas, prazos e ações-chave.' },
];

export const sectionsByArea = (area) => sections.filter(section => section.area === area);

export const sectionTitles = sections.map(section => section.title);

export const limits = Object.fromEntries(sections.map(section => [section.title, section.limit]));
