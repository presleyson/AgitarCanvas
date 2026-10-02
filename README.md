# AGITAR Canvas

Implementação digital do **Modelo de Gestão da Inovação Tecnológica (AGITAR Canvas)**, proposto na tese de doutorado de Presleyson Plínio de Lima (Universidade FUMEC, 2024) para apoiar a gestão da inovação em Pequenas e Médias Empresas (PMEs) de Tecnologia da Informação e Comunicação (TIC).

**Título da tese:** Modelo de Gestão da Inovação Tecnológica para Pequenas e Médias Empresas de Tecnologia da Informação e Comunicação.

**Aplicação publicada:** <https://presleyson.github.io/AgitarCanvas/>

## Sumário

- [Sobre o AGITAR Canvas](#sobre-o-agitar-canvas)
- [Origem do projeto](#origem-do-projeto)
- [Objetivo](#objetivo)
- [Fundamentação acadêmica](#fundamentação-acadêmica)
- [Como funciona](#como-funciona)
- [Como utilizar](#como-utilizar)
- [Principais funcionalidades](#principais-funcionalidades)
- [Aplicações do AGITAR Canvas](#aplicações-do-agitar-canvas)
- [Tecnologias utilizadas](#tecnologias-utilizadas)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Execução](#execução)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Contribuição](#contribuição)
- [Referência acadêmica](#referência-acadêmica)
- [Licença](#licença)

## Sobre o AGITAR Canvas

O AGITAR Canvas é uma ferramenta digital de apoio à gestão da inovação tecnológica. Ele apresenta, em uma única tela, um quadro com nove blocos nos quais a empresa registra, por meio de post-its, os elementos centrais de um projeto de inovação: o planejamento estratégico, o problema a resolver, o mercado, as ideias geradas e selecionadas, os recursos financeiros e técnicos, os principais parceiros e os resultados esperados.

A aplicação tem origem em uma pesquisa de doutorado e foi desenvolvida a partir do modelo de gestão da inovação tecnológica proposto na tese. O software não é um produto independente da pesquisa: ele é o instrumento pelo qual o modelo foi levado às empresas participantes do estudo e é descrito no Capítulo 6 da tese ("Agitar Canvas Software").

**Público para o qual foi concebido:** PMEs do setor de TIC, seus gestores, comitês de inovação e agentes de inovação. Por sua origem acadêmica, pode também interessar a pesquisadores, professores e estudantes de gestão da inovação tecnológica.

## Origem do projeto

O projeto dá continuidade a uma linha de pesquisa iniciada na dissertação de mestrado do autor, que estudou os modelos de gestão da inovação em PMEs de TIC e se concentrou no MOGIT (Modelo de Gestão da Inovação Tecnológica) (Lima, 2020). A partir desse estudo e da implementação de projetos de gestão da inovação tecnológica, foram identificadas lacunas nos modelos existentes. Entre elas, a tese destaca o tratamento insuficiente da etapa de geração de ideias, frequentemente subordinada ao modelo global em vez de detalhada como fase própria.

A tese de doutorado propõe o AGITAR Canvas como evolução do MOGIT e parte da seguinte pergunta de pesquisa:

> Como o modelo de gestão da inovação tecnológica pode contribuir para o desenvolvimento das Pequenas e Médias Empresas (PMEs) no setor de Tecnologia da Informação e Comunicação (TIC)?

O contexto que motiva o trabalho é o das PMEs de TIC, que respondem por parcela relevante da inovação tecnológica e do emprego no país, mas que em geral dispõem de recursos financeiros e humanos limitados e podem não ter o conhecimento ou a experiência necessários para gerenciar projetos de inovação.

Este repositório contém a aplicação prática dessa proposta. O software transforma a metodologia descrita no trabalho acadêmico em um quadro que pode ser preenchido pelas organizações, de modo que o modelo deixe de ser apenas uma representação conceitual e passe a ser utilizado em atividades concretas de gestão da inovação.

## Objetivo

O objetivo geral da tese é desenvolver e aplicar um modelo de gestão da inovação tecnológica especificamente projetado para PMEs atuantes no setor de TIC. O software é o meio de aplicação desse modelo. Em termos práticos, o AGITAR Canvas busca apoiar as empresas a:

- **Organizar** as informações de um projeto de inovação tecnológica em uma estrutura única, com nomenclatura comum a todos os envolvidos.
- **Analisar** o problema a ser resolvido, o mercado-alvo e a viabilidade das ideias antes de comprometer recursos.
- **Planejar** a inovação de forma alinhada ao planejamento estratégico, com objetivos, metas, prazos e ações-chave.
- **Mapear** os recursos financeiros e técnicos e os parceiros necessários, considerando o ecossistema de inovação (universidades, parques tecnológicos, fornecedores, governos e investidores).
- **Acompanhar** os resultados esperados, que servem de referência para avaliar o projeto ao longo do tempo.

## Fundamentação acadêmica

O AGITAR Canvas está fundamentado na seguinte tese de doutorado, utilizada como referência conceitual e metodológica para o desenvolvimento da solução:

| | |
|---|---|
| **Título** | Modelo de Gestão da Inovação Tecnológica para Pequenas e Médias Empresas de Tecnologia da Informação e Comunicação |
| **Autor** | Dr. Presleyson Plínio de Lima |
| **Orientador** | Prof. Dr. Luiz Cláudio Gomes Maia |
| **Instituição** | Universidade FUMEC, Faculdade de Ciências Empresariais |
| **Programa** | Pós-Graduação Stricto Sensu em Tecnologia da Informação e Comunicação e Gestão do Conhecimento |
| **Linha de pesquisa** | Tecnologias de Informação e da Comunicação |
| **Local e ano** | Belo Horizonte/MG, 2024 (defesa em 02/04/2024) |

### Metodologia da pesquisa

- **Construção do modelo:** revisão sistemática da literatura e fundamentação teórica sobre inovação tecnológica, gestão da inovação, cultura e ecossistema de inovação, e barreiras à inovação em PMEs de TIC.
- **Abordagem:** qualitativa, com múltiplos estudos de caso.
- **Amostra:** três PMEs de TIC de Belo Horizonte/MG, selecionadas por acessibilidade e mantidas em anonimato.
- **Coleta de dados:** questionário estruturado e entrevistas sobre a aplicação do software AGITAR Canvas, organizados nas mesmas nove categorias do quadro.
- **Análise:** mineração de texto em Python, com frequência de unigramas e bigramas, nuvens de palavras, análise de sentimentos com o modelo FinBERT-PT-BR e TF-IDF.
- **Ética:** pesquisa registrada na Plataforma Brasil (CAAE 76565923.0.0000.5155) e aprovada pelo Comitê de Ética em Pesquisa da Universidade FUMEC (parecer nº 6.646.848).

### O acrônimo AGITAR

Na tese, AGITAR designa um modelo estruturado para a gestão da inovação tecnológica, que abrange da identificação de oportunidades à implementação e ao aperfeiçoamento de soluções inovadoras:

| Letra | Fase | Descrição |
|---|---|---|
| **A** | Avaliação constante | Avaliação contínua das necessidades dos clientes e do mercado, de modo a identificar oportunidades para inovação. |
| **G** | Geração de ideias | Geração de ideias inovadoras, com incentivo à colaboração e à criatividade da equipe. |
| **I** | Implementação ágil | Implementação ágil e eficiente dos projetos de inovação, para que as ideias se transformem em soluções práticas. |
| **T** | Testes e validação | Teste e validação das novas soluções em ambiente controlado antes do lançamento no mercado. |
| **A** | Acompanhamento contínuo | Acompanhamento do desempenho e do retorno de clientes e partes interessadas. |
| **R** | Realinhamento constante | Realinhamento da gestão da inovação diante das mudanças do mercado e das evoluções tecnológicas. |

### Estrutura do modelo

O modelo (Figura 5.1 da tese) é representado em camadas concêntricas e descrito no Capítulo 5 nas seguintes seções:

- **Problema**, no centro do modelo.
- **Mercado**.
- **Ideia**, com o Processo de Geração de Ideias e o Processo de Seleção de Ideias.
- **Processo Contínuo de Inovação**, apoiado no conceito de ecossistema de inovação e na Hélice Tríplice, com os agentes: Universidade, Parques Tecnológicos, Comitê de Inovação, Governos, Organizações Setoriais, Investidores, Agentes de Inovação, Colaboradores, Departamentos, Sócios e Fornecedores.
- **Resultado**.
- **Planejamento Estratégico**, camada externa que envolve as demais.

### Resultados e limites do estudo

Segundo a tese, a aplicação do modelo nas empresas participantes indicou benefícios em organização interna, foco estratégico na inovação e aproveitamento dos recursos disponíveis, e as análises de sentimentos e TF-IDF reforçaram a percepção positiva do modelo.

A própria tese registra os limites dessa evidência: o estudo é qualitativo, abrange três empresas, teve número restrito de respondentes e não contou com pré-teste. O escopo foi delimitado a PMEs de TIC, sem incluir microempresas (menos de 20 colaboradores) nem grandes corporações (mais de 300 colaboradores). A aplicação em outros portes e setores é indicada como trabalho futuro.

## Como funciona

A aplicação exibe o quadro do AGITAR Canvas em uma única página. Cada bloco traz um título e um texto de orientação. O usuário adiciona post-its aos blocos, e o conjunto dos post-its forma o planejamento da inovação da empresa.

### Disposição do quadro

```
+------------+----------+-------------+--------------+-----------+----------+
| Principais | Recursos | Recursos    | Ideias       | Geração   | Mercado  |
| Parceiros  | Técnicos | Financeiros | Selecionadas | de ideias +----------+
|            |          |             |              |           | Problema |
+------------+----------+-------------+--------------+-----------+----------+
| Resultados                          | Planejamento Estratégico            |
+-------------------------------------+-------------------------------------+
```

### Os nove blocos

Os nomes abaixo são os utilizados no software e correspondem às nove categorias de análise da tese.

| Bloco | O que registrar | Limite de post-its |
|---|---|---|
| **Planejamento Estratégico** | Objetivos que a empresa espera alcançar, com metas, prazos e ações-chave. | 6 |
| **Problema** | Principais problemas que a empresa busca resolver e como eles afetam os clientes ou o mercado. | 2 |
| **Mercado** | Mercado-alvo no qual a empresa concentrará seus esforços de inovação. | 2 |
| **Geração de ideias** | Ideias vindas de pesquisas de mercado, sessões de brainstorming e outras técnicas. | 5 |
| **Ideias Selecionadas** | Ideias consideradas mais viáveis entre as geradas. | 5 |
| **Recursos Financeiros** | Potenciais fontes de financiamento, como investidores privados, capital de risco e subsídios governamentais. | 5 |
| **Recursos Técnicos** | Instituições ou organizações que podem fornecer suporte técnico, como universidades, parques tecnológicos ou fornecedores. | 5 |
| **Principais Parceiros** | Principais colaboradores, agentes, departamentos ou sócios. | 5 |
| **Resultados** | Resultados ou objetivos que a empresa espera alcançar com o projeto. | 6 |

Os limites de post-its por bloco são definidos pelo software, em `src/utils/strings.js`.

### Relação entre o modelo e o quadro

O quadro do software organiza em blocos retangulares os elementos que o modelo conceitual apresenta em camadas. A leitura conjunta da Figura 5.1 e do Capítulo 6 da tese indica a seguinte correspondência:

| Modelo (Capítulo 5) | Blocos do software |
|---|---|
| Problema | Problema |
| Mercado | Mercado |
| Ideia (Geração e Seleção de Ideias) | Geração de ideias; Ideias Selecionadas |
| Processo Contínuo de Inovação (agentes do ecossistema) | Recursos Financeiros; Recursos Técnicos; Principais Parceiros |
| Resultado | Resultados |
| Planejamento Estratégico | Planejamento Estratégico |

### Sequência de preenchimento

O software não impõe ordem de preenchimento. A tese (seção 6.3) descreve o uso na seguinte sequência, em que cada bloco se apoia no anterior:

1. **Planejamento Estratégico:** define os objetivos e orienta todas as atividades seguintes.
2. **Problema:** delimita o escopo do projeto.
3. **Mercado:** determina onde a empresa concentrará os esforços de inovação.
4. **Geração de ideias:** reúne as possibilidades antes de se optar por uma direção.
5. **Ideias Selecionadas:** destaca as soluções mais viáveis, segundo critérios definidos no planejamento estratégico.
6. **Recursos Financeiros:** mapeia as fontes de financiamento.
7. **Recursos Técnicos:** identifica as organizações que podem oferecer suporte técnico.
8. **Principais Parceiros:** identifica quem terá papel determinante no projeto.
9. **Resultados:** registra o que se espera alcançar e serve de referência para avaliação.

## Como utilizar

### 1. Acessar a plataforma

Abra <https://presleyson.github.io/AgitarCanvas/> em um navegador. Não há instalação, cadastro ou login. O quadro foi desenhado para telas de computador e não possui layout adaptado a telas pequenas.

### 2. Criar um planejamento

Cada acesso abre um quadro em branco, que corresponde a um planejamento. A versão atual trabalha com um único quadro por sessão e não possui gerenciamento de projetos. Para iniciar um novo planejamento, recarregue a página, lembrando que isso apaga o conteúdo do quadro atual.

### 3. Preencher o AGITAR Canvas

1. Clique em **Adicionar Post-it**, no canto inferior direito.
2. No campo **Seção**, escolha o bloco do quadro.
3. No campo **Descrição**, escreva o conteúdo do post-it.
4. Clique em **Salvar**.

O post-it aparece no bloco escolhido e o texto de orientação do bloco deixa de ser exibido. Os dois campos são obrigatórios. Quando o bloco já atingiu o limite de post-its, a aplicação exibe um aviso e mantém o texto digitado, para que seja possível escolher outro bloco.

### 4. Salvar as informações

O botão **Salvar** registra o post-it no quadro durante a sessão em uso. **A versão atual não grava os dados de forma permanente:** o conteúdo fica apenas na memória do navegador e é perdido ao recarregar ou fechar a página. Antes de encerrar, guarde o resultado por impressão ou PDF (item 8).

### 5. Reabrir um planejamento

Não é possível reabrir um quadro em outra sessão. Para retomar um planejamento, consulte o PDF ou a impressão anterior e registre novamente os post-its.

### 6. Atualizar um planejamento existente

Durante a sessão, o quadro pode ser revisto livremente:

- **Editar:** clique sobre o post-it, altere a descrição, clique em **Salvar** e confirme a edição.
- **Mover para outro bloco:** na edição, escolha outra opção no campo **Seção**.
- **Apagar:** passe o cursor sobre o post-it, clique em **Apagar** e confirme. Quando o bloco fica vazio, o texto de orientação volta a ser exibido.

### 7. Compartilhar e colaborar

A aplicação não possui contas de usuário, compartilhamento por link nem edição simultânea. O uso colaborativo ocorre com um único quadro aberto, projetado ou compartilhado em tela, com uma pessoa registrando as contribuições do grupo. O resultado pode ser distribuído em PDF.

### 8. Exportar ou imprimir

Não há função de exportação dedicada. Utilize a impressão do navegador (`Ctrl+P` ou `Cmd+P`) e, para gerar um arquivo, escolha a opção de salvar como PDF. Na impressão, os textos de orientação dos blocos são ocultados. Para manter a cor dos post-its, ative a impressão de cores de fundo nas opções do navegador.

## Principais funcionalidades

### Implementadas

- Quadro com os nove blocos do AGITAR Canvas e textos de orientação em cada bloco.
- Inclusão de post-its com escolha do bloco e descrição.
- Edição de post-its, inclusive com mudança de bloco, com confirmação.
- Exclusão de post-its, com confirmação.
- Validação de preenchimento: seção obrigatória, descrição não vazia e limite de post-its por bloco.
- Estilo de impressão que oculta os textos de orientação.
- Diálogos com suporte a teclado e leitores de tela.
- Testes automatizados das regras de inclusão, edição, exclusão e limites.
- Publicação automática no GitHub Pages a cada alteração na branch `main`.

### Não disponíveis na versão atual

- Gravação permanente dos dados e reabertura de quadros.
- Criação e gerenciamento de múltiplos projetos.
- Exportação em arquivo próprio (PDF, imagem ou dados).
- Contas de usuário e autenticação.
- Compartilhamento e edição colaborativa em tempo real.
- Layout para dispositivos móveis.

A introdução do Capítulo 6 da tese menciona a criação de novos projetos e a exportação do projeto entre os tópicos de uso do software. Essas duas funcionalidades não estão implementadas no código deste repositório.

## Aplicações do AGITAR Canvas

As possibilidades a seguir decorrem da estrutura do modelo e do uso descrito na tese. A pesquisa avaliou a aplicação do software em três PMEs de TIC, e o emprego em outros contextos deve considerar os limites indicados em [Fundamentação acadêmica](#fundamentação-acadêmica).

- **Planejamento da inovação:** o preenchimento na sequência proposta, a partir do Planejamento Estratégico, vincula cada iniciativa de inovação aos objetivos da empresa.
- **Diagnóstico organizacional:** blocos que permanecem vazios ou imprecisos apontam aspectos da gestão da inovação ainda não tratados pela empresa. O questionário do apêndice da tese, organizado nas mesmas nove categorias, pode servir de roteiro para esse levantamento.
- **Discussão estratégica:** o quadro reúne em uma única visão problema, mercado, ideias, recursos e resultados, o que oferece uma linguagem comum a sócios, gestores e equipes técnicas.
- **Workshops:** os blocos Geração de ideias e Ideias Selecionadas registram, respectivamente, o resultado de sessões de brainstorming e a escolha das ideias mais viáveis.
- **Reuniões de gestão:** o quadro pode ser revisto periodicamente por gestores ou pelo comitê de inovação, em linha com as fases de acompanhamento contínuo e realinhamento constante do modelo.
- **Estruturação de iniciativas de inovação:** um quadro por iniciativa documenta escopo, mercado, recursos e resultados esperados antes do início da execução.
- **Análise das capacidades relacionadas à inovação:** os blocos Recursos Financeiros, Recursos Técnicos e Principais Parceiros mapeiam os recursos internos e as relações com o ecossistema de inovação de que a empresa dispõe.

## Tecnologias utilizadas

| Camada | Tecnologia |
|---|---|
| Linguagem | JavaScript (JSX) e CSS |
| Biblioteca de interface | React 18 |
| Ferramentas de build | Create React App (`react-scripts` 5.0.1) |
| Componentes | `@radix-ui/react-dialog` (diálogos), `react-icons` (ícones) |
| Utilitários | `uuid` (identificadores dos post-its) |
| Tipografia | Montserrat, carregada do Google Fonts |
| Testes | Jest e React Testing Library |
| Publicação | GitHub Actions e pacote `gh-pages` |
| Hospedagem | GitHub Pages |

A aplicação é executada inteiramente no navegador. Não há servidor de aplicação, banco de dados, API nem autenticação, e o estado do quadro é mantido em memória pelo React.

## Instalação

**Requisitos**

- Node.js 20 (versão utilizada na publicação automática) ou superior
- npm
- Git

**Passos**

```bash
git clone https://github.com/presleyson/AgitarCanvas.git
cd AgitarCanvas
npm install
```

## Configuração

O projeto não exige variáveis de ambiente nem arquivo `.env`.

A única configuração relevante é o campo `homepage` do `package.json`, que define o caminho base em que a aplicação é servida (`/AgitarCanvas/`). Ao publicar uma cópia em outro endereço, ajuste esse campo para a nova URL.

## Execução

**Ambiente local**

```bash
npm start
```

A aplicação fica disponível em <http://localhost:3000/AgitarCanvas>.

**Testes**

```bash
npm test
```

Para uma execução única, sem o modo interativo:

```bash
npm test -- --watchAll=false
```

**Build de produção**

```bash
npm run build
```

Os arquivos são gerados na pasta `build/`.

**Deploy**

A publicação é automática. A cada alteração na branch `main`, o workflow `.github/workflows/deploy.yml` instala as dependências, executa os testes, gera a build e publica o resultado na branch `gh-pages`, que é a origem do site no GitHub Pages. Se os testes falharem, a publicação não ocorre. O workflow também pode ser acionado manualmente na aba Actions do GitHub.

Como alternativa, quem possui permissão de escrita no repositório pode publicar a partir da própria máquina:

```bash
npm run deploy
```

## Estrutura do projeto

```
AgitarCanvas/
├── .github/workflows/
│   └── deploy.yml            # Teste, build e publicação no GitHub Pages
├── public/
│   ├── index.html            # Página base da aplicação
│   └── icone.svg             # Ícone do site
├── src/
│   ├── index.js              # Ponto de entrada
│   ├── home/
│   │   ├── index.js          # Tela do quadro e regras de inclusão, edição e exclusão
│   │   ├── Home.test.js      # Testes automatizados
│   │   └── style.css
│   ├── components/
│   │   ├── canva-area/       # Bloco do quadro (título e texto de orientação)
│   │   ├── post-it-area/     # Lista de post-its de um bloco
│   │   ├── post-it/          # Post-it, com ações de editar e apagar
│   │   ├── modal/            # Formulário de inclusão e edição
│   │   └── pop-up/           # Diálogo de confirmação
│   ├── utils/
│   │   ├── strings.js        # Definição dos nove blocos: títulos, posições, limites e textos
│   │   └── validaQuantidade.js   # Regra de limite de post-its por bloco
│   ├── styles/
│   │   └── global.css        # Estilos globais e de impressão
│   └── setupTests.js
├── package.json
└── README.md
```

O arquivo `src/utils/strings.js` é a fonte única da estrutura do quadro. Títulos, posições, limites e textos de orientação dos blocos são definidos nele e reutilizados pelos demais módulos.

## Contribuição

Contribuições são bem-vindas por meio de issues e pull requests.

1. Crie uma branch a partir de `main`.
2. Faça as alterações e execute `npm test -- --watchAll=false`.
3. Abra um pull request descrevendo a mudança e sua motivação.

Como o software implementa um modelo acadêmico, alterações nos nomes, na quantidade ou no significado dos blocos devem preservar a correspondência com a tese. Novas funcionalidades devem ser acompanhadas da atualização deste README, na seção [Principais funcionalidades](#principais-funcionalidades).

## Referência acadêmica

Ao utilizar o AGITAR Canvas em trabalhos acadêmicos, relatórios ou publicações, recomenda-se citar a tese que o fundamenta.

**ABNT**

> LIMA, Presleyson Plínio de. **Modelo de gestão da inovação tecnológica para pequenas e médias empresas de tecnologia da informação e comunicação**. 2024. 261 f. Tese (Doutorado em Tecnologia da Informação e Comunicação e Gestão do Conhecimento) – Faculdade de Ciências Empresariais, Universidade FUMEC, Belo Horizonte, 2024.

**BibTeX**

```bibtex
@phdthesis{lima2024agitar,
  author  = {Lima, Presleyson Plínio de},
  title   = {Modelo de Gestão da Inovação Tecnológica para Pequenas e Médias Empresas de Tecnologia da Informação e Comunicação},
  school  = {Universidade FUMEC},
  address = {Belo Horizonte},
  year    = {2024},
  type    = {Tese (Doutorado em Tecnologia da Informação e Comunicação e Gestão do Conhecimento)}
}
```

**Trabalho anterior do autor**

> LIMA, Presleyson Plínio de. **Os modelos de gestão da inovação em pequenas e médias empresas de tecnologia da informação e comunicação**. 2020. Dissertação (Mestrado) – Universidade FUMEC, Belo Horizonte, 2020.

## Licença

Este repositório ainda não define uma licença. Até que um arquivo de licença seja adicionado, o uso, a modificação e a redistribuição do código dependem de autorização do autor.
