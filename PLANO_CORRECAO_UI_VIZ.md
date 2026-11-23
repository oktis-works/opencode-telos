# Plano de correção da UI do `/sdd viz`

**Status:** implementado na versão 3.4.0; validação visual manual em navegador pendente.
**Avaliação de comandos:** concluída em 2026-11-23; Fase 9 implementada.
**Data:** 2026-11-23
**Escopo:** dashboard servido por `/sdd viz` — visão Graph, visão Kanban, modal de task, filtros, estados de erro, acessibilidade e responsividade.
**Escopo adicional:** feedback inline dos comandos determinísticos `/sdd` (Fase 9).
**Fora de escopo:** mudar o gate de aprovação de task, alterar a semântica de Change, redesenhar o produto em outro framework ou modificar o modelo de dados do grafo.

> Este documento registra o plano e o resultado da execução. As caixas de cada fase foram mantidas como checklist de implementação; o estado real está resumido na tabela da seção 8.

---

## 1. Diagnóstico priorizado

| Prioridade | Problema | Evidência | Impacto |
|---|---|---|---|
| P0 | O Kanban usa `/api/graph`, que devolve apenas `id`, `type`, `name`, `status` e `version` das tasks | `GET /api/graph` retorna uma task sem `metadata`, `created_at` ou `updated_at` | Prioridade, aprovação, integração, Change, goal, arquivos, escopo-alvo e acceptance não aparecem |
| P0 | Editar e salvar uma task pode apagar dados | O modal abre com a task resumida; os campos ficam vazios e o `Save` envia `files: []`, `goal: ""` e `priority: "medium"` | Pode apagar escopo de arquivos, goal e prioridade, além de invalidar uma aprovação |
| P1 | Filtros de vínculo e ordenação por links usam o formato errado | Kanban procura `r.source`/`r.target`; `/api/graph` devolve `from`/`to` | “Linked”, “Unlinked”, filtros por tipo e ordenação por links não funcionam |
| P1 | Ordenar por `Created` ou `Updated` quebra a ordenação | `a.created_at.localeCompare(...)` com campo ausente no resumo | O board não atualiza e ocorre erro no console |
| P1 | O campo de busca abre com `"all"` | `setVal` aplica `val || "all"` também ao input de busca | A interface mostra uma busca inexistente; o botão `Clear` repete o problema |
| P1 | O filtro ativo do grafo perde o estado visual | `renderFilters()` sempre cria o botão `All` com `active` | Após o poll, o filtro aplicado e o botão destacado ficam diferentes |
| P1 | O grafo depende de CDN externo | `3d-force-graph` é carregado de `unpkg.com` | Sem internet o grafo falha e o Kanban pode ficar sem dados |
| P2 | Comandos `/sdd` não têm um contrato de confirmação inline curta | `/sdd on` e `/sdd off` devolvem várias linhas, incluindo timestamp e caminho do toggle | A confirmação existe, mas não é imediata nem padronizada para o usuário; o detalhe operacional se mistura com a mensagem |
| P2 | Falhas de API não aparecem na interface | `loadGraph()` apenas faz `console.error` | A tela fica em “Loading...” ou vazia, sem retry ou explicação |
| P2 | Modal sem semântica de diálogo e sem navegação por teclado | Sem `role="dialog"`, `aria-modal`, foco preso ou `Escape` | Usuários de teclado e leitores de tela ficam presos no fundo da página |
| P2 | Cards e itens da lista de nós não são focáveis | São `div`/`li` apenas com `click` | Não é possível abrir detalhes ou tasks apenas com teclado |
| P2 | Layout sem breakpoints | Sidebars fixas de `280px` e `320px`, board de cinco colunas | Experiência ruim em notebooks, tablets e celulares |
| P3 | Hierarquia visual densa | Toolbar com muitos controles, badges de 9px, ações destrutivas próximas | Aumenta erro operacional e dificulta leitura |
| P3 | Ações destrutivas sem confirmação | `Delete` e `Reject` executam direto | Exclusão ou rejeição acidental |
| P3 | Cobertura de teste não valida a integração da UI | Testes verificam HTML estático e APIs separadamente | Os bugs acima passam despercebidos |

### Evidência do contrato atual

```text
GET /api/graph -> task:
{
  "id": "...",
  "type": "task",
  "name": "...",
  "status": "todo",
  "version": 1
}

GET /api/tasks -> TaskBoardItem:
{
  "metadata": { ... },
  "priority": "critical",
  "approval": { "status": "PENDING" },
  "integration_status": "pending",
  "change_id": "...",
  "change_status": "...",
  "created_at": "...",
  "updated_at": "...",
  "links": [
    { "node_id": "FEAT-001", "node_type": "feature", "node_name": "..." }
  ]
}
```

---

## 2. Decisões de arquitetura

1. **O Kanban terá `/api/tasks` como fonte de verdade.** `/api/graph` continua sendo o payload leve do grafo 3D. Não adicionar metadata de tasks ao `/api/graph`; isso aumentaria o payload do grafo e duplicaria responsabilidades.
2. **O Kanban não dependerá de `allNodes` nem de `allLinks`.** Criar um estado `allTasks` próprio. `allNodes`/`allLinks` continuam exclusivos da visão Graph.
3. **Vínculos serão lidos de `TaskBoardItem.links`.** Cada link já traz `node_id`, `node_type`, `node_name`, `type` e `direction`; não é necessário reconstruir relacionamentos no cliente.
4. **Toda edição usará a task completa e `expected_version`.** O modal só abre depois de receber o `TaskBoardItem` completo; o `Save` envia a versão conhecida para detectar edição concorrente.
5. **Busca vazia continuará vazia.** Inputs de texto e selects terão setters diferentes; `"all"` nunca será usado como fallback de busca.
6. **O contrato de `/api/graph` será preservado.** A correção não deve obrigar o grafo a carregar metadata de todas as tasks.
7. **O grafo deve degradar com elegância.** Se a biblioteca 3D não carregar, o Kanban, a lista de nós e as APIs continuam funcionando, com uma mensagem clara e opção de retry.
8. **O gate de escrita não muda.** Aprovar task continua sendo a autorização; Change continua sendo auditoria/evolução.
9. **Nenhuma edição de vínculo será adicionada nesta rodada.** O modal mostrará os vínculos atuais em modo somente leitura; criar vínculo continua sendo uma ação da criação ou do agente.
10. **A correção será incremental.** Primeiro dados e comportamento, depois resiliência, depois UX, acessibilidade e responsividade. Cada fase deve ter teste ou verificação própria.
11. **Comandos `/sdd` continuam determinísticos.** O retorno curto padrão deve ser produzido pelo próprio handler e entregue via `ctx.session.synthetic`, sem turno de LLM. Um turno de LLM só pode ser usado como fallback quando o host não suportar `synthetic`, sempre com instrução fechada de confirmação, sem permissão para decidir ou repetir a ação.

---

## 3. Fases e checklists

### Fase 0 — Baseline e testes que reproduzem os bugs

**Objetivo:** congelar o comportamento atual e garantir que as correções sejam verificáveis.

- [ ] Registrar no início da implementação a saída de `GET /api/graph` para uma task com metadata completa.
- [ ] Registrar a saída de `GET /api/tasks` para a mesma task e confirmar `metadata`, `priority`, `approval`, `created_at`, `updated_at` e `links`.
- [ ] Criar teste de contrato que falhe enquanto o Kanban depender de `/api/graph`.
- [ ] Criar teste que reproduza a perda de `goal`, `files` e `priority` ao editar uma task existente.
- [ ] Criar teste que reproduza a ordenação por `created_at`/`updated_at` com dados incompletos.
- [ ] Criar teste que reproduza o filtro de vínculo com `TaskBoardItem.links`.
- [ ] Criar teste estático que detecte o input de busca sendo preenchido com `"all"`.
- [ ] Criar teste estático que detecte o uso de `source`/`target` no Kanban onde o contrato é `from`/`to`.
- [ ] Adicionar ao plano a lista de testes que devem passar ao final de cada fase.
- [ ] Rodar a suíte antes das mudanças e registrar o baseline:
  ```bash
  bun test tests/tasks-api.test.ts
  bun run typecheck
  ```

**Critério de saída:** os bugs P0/P1 têm pelo menos um teste ou uma verificação reproduzível antes da correção.

---

### Fase 1 — Kanban consumindo `/api/tasks`

**Objetivo:** eliminar a causa raiz da maior parte dos problemas, sem tocar no contrato do grafo.

- [ ] Criar o estado `allTasks` no script do Kanban.
- [ ] Criar `loadTasks()` com `fetch("/api/tasks")`.
- [ ] Validar `res.ok` antes de ler o JSON.
- [ ] Validar que `data.tasks` é um array antes de renderizar.
- [ ] Guardar os itens completos em `allTasks`.
- [ ] Fazer `taskNodes()` retornar `allTasks`, não `allNodes`.
- [ ] Remover a dependência de `allLinks` dos filtros e da ordenação do Kanban.
- [ ] Usar `task.links` para “Linked”, “Unlinked”, filtro por tipo e contagem de links.
- [ ] Usar `task.metadata` para goal, arquivos, acceptance, escopo e Change.
- [ ] Usar `task.priority` em vez de `task.metadata.priority || "medium"`.
- [ ] Usar `task.approval.status` em vez de `task.metadata.approval.status`.
- [ ] Usar `task.integration_status` em vez de `task.metadata.integration_status`.
- [ ] Usar `task.change_id`/`task.change_status` em vez de campos de metadata.
- [ ] Usar `task.created_at`/`task.updated_at` para ordenação.
- [ ] Fazer o Kanban carregar independentemente do grafo: se `/api/tasks` funcionar e `/api/graph` falhar, o board ainda aparece.
- [ ] Fazer o grafo carregar independentemente do Kanban: se `/api/graph` falhar, o board ainda aparece.
- [ ] Criar `refreshBoard()` para recarregar apenas as tasks após mutações.
- [ ] Chamar `refreshBoard()` após criar, editar, mover, aprovar, rejeitar, integrar, abrir Change e excluir.
- [ ] Evitar respostas antigas sobrescrevendo dados novos; usar um contador de requisição ou `AbortController`.
- [ ] Manter `/api/graph` sem metadata de tasks e documentar essa decisão no código/comentário.
- [ ] Adicionar mensagem de erro e botão `Retry` no board quando `/api/tasks` falhar.
- [ ] Preservar o último board válido enquanto uma atualização falha.

**Critério de saída:** o Kanban exibe prioridade, aprovação, integração, Change, goal, arquivos, escopo e acceptance corretamente, mesmo com `/api/graph` indisponível.

---

### Fase 2 — Correções funcionais do Kanban

**Objetivo:** fazer busca, filtros, ordenação, contadores e badges refletirem os dados completos.

#### Busca

- [ ] Separar `setTextValue(id, value)` de `setSelectValue(id, value)`.
- [ ] Garantir que `kanban-search` comece vazio quando não houver filtro salvo.
- [ ] Garantir que `Clear` deixe a busca vazia.
- [ ] Normalizar buscas antigas persistidas em `localStorage` (`"all"` deve virar `""`).
- [ ] Incluir na busca: `id`, `name`, `description`, `metadata.goal`, `metadata.files`, `metadata.acceptance`, `metadata.legacy_acceptance` e nomes/tipos de `links`.
- [ ] Fazer a busca ser case-insensitive e com `trim()`.
- [ ] Manter o debounce atual de 200 ms.
- [ ] Exibir a contagem de resultados após a busca.

#### Filtros

- [ ] Filtro `linked`: `task.links.length > 0`.
- [ ] Filtro `unlinked`: `task.links.length === 0`.
- [ ] Filtro por tipo: `task.links.some(link => link.node_type === filtro)`.
- [ ] Filtro de integração: usar `task.integration_status`.
- [ ] Filtro de prioridade: usar `task.priority`.
- [ ] Filtro de coluna: usar `task.column` ou `statusToColumn(task.status)`.
- [ ] Filtro de escopo: usar `metadata.execution_scope === "target"` ou `metadata.purpose === "reverse_engineering"`.
- [ ] Persistir e restaurar todos os filtros em `localStorage`.
- [ ] Sanitizar filtros desconhecidos ao restaurar.
- [ ] Atualizar a URL? Não é necessário nesta rodada; manter o estado local.
- [ ] Exibir chips ou resumo dos filtros ativos.
- [ ] Adicionar botão `Clear` que limpe busca, filtros e ordenação de uma vez.

#### Ordenação

- [ ] `priority`: usar `task.priority` e manter a ordem `critical → high → medium → low` em ordem ascendente.
- [ ] `name`: usar `localeCompare` com `pt-BR` ou locale consistente.
- [ ] `created`: comparar `task.created_at` com fallback seguro; nunca chamar método em `undefined`.
- [ ] `updated`: comparar `task.updated_at` com fallback seguro.
- [ ] `integration`: usar `task.integration_status`.
- [ ] `links`: usar `task.links.length`.
- [ ] `column`: manter o agrupamento atual e os tiebreakers estáveis.
- [ ] Ao escolher `created`/`updated`, sugerir `desc` como direção padrão.
- [ ] Garantir que nenhuma combinação de filtro + ordenação lance exceção.

#### Contadores e badges

- [ ] Contador de integração pendente: `task.integration_status === "pending"`.
- [ ] Contador de Changes aguardando aprovação: `task.change_id` + `task.change_status` em `DRAFT`/`PROPOSED`.
- [ ] Badge de prioridade usando `task.priority`.
- [ ] Badge de aprovação usando `task.approval.status`.
- [ ] Badge target backlog usando `metadata.execution_scope`/`metadata.purpose`.
- [ ] Badge de Change usando `task.change_id`/`task.change_status`.
- [ ] Badge de arquivos usando `metadata.files.length`.
- [ ] Badge de goal usando `metadata.goal`.
- [ ] Não exibir badge de campos vazios quando não houver dado real.

#### Atualização após mutações

- [ ] Após mover card, recarregar tasks e manter o filtro ativo.
- [ ] Após salvar task, recarregar tasks antes de fechar o modal.
- [ ] Após excluir, recarregar tasks e fechar o modal.
- [ ] Após aprovar/rejeitar, recarregar tasks e atualizar badges.
- [ ] Após abrir Change, recarregar tasks e atualizar `change_id`/`change_status`.
- [ ] Após integrar, recarregar tasks e atualizar o badge de integração.
- [ ] Se a recarga falhar, manter os dados atuais e mostrar erro não bloqueante.

**Critério de saída:** todos os filtros, a busca, as ordenações e os badges funcionam com uma task que tenha prioridade, aprovação, Change, goal, arquivos, vínculos e escopo-alvo.

---

### Fase 3 — Modal, edição segura e ações destrutivas

**Objetivo:** impedir perda de dados e tornar as ações previsíveis.

- [ ] Abrir o modal somente com um `TaskBoardItem` completo.
- [ ] Se a task não estiver em `allTasks`, buscar `/api/tasks` antes de abrir.
- [ ] Preencher `goal`, `files`, `priority`, `column`, `acceptance` e vínculos com os dados completos.
- [ ] Enviar `expected_version` no `Save` de uma task existente.
- [ ] Tratar `409 Version conflict` com mensagem clara e recarga da task.
- [ ] Não enviar `files`/`goal`/`priority` quando o usuário não alterou esses campos; ou enviar o valor completo recebido.
- [ ] Garantir que salvar uma task sem alterar nada não modifique `updated_at`, aprovação ou integração.
- [ ] Em modo de edição, esconder o campo `Link to` e exibir os vínculos atuais em modo somente leitura.
- [ ] Em modo de criação, manter o campo `Link to` e validar o ID antes de salvar.
- [ ] Desabilitar `Save` durante a requisição.
- [ ] Desabilitar `Delete`, `Reject`, `Approve` e `Open Change` durante operações concorrentes.
- [ ] Fechar o modal somente depois de a recarga do board terminar.
- [ ] Pedir confirmação antes de `Delete`.
- [ ] Pedir confirmação antes de `Reject`.
- [ ] Pedir confirmação antes de aprovar um Change existente que vá gerar código.
- [ ] Adicionar aviso de alterações não salvas ao fechar por `Cancel`, `Escape` ou clique no backdrop.
- [ ] Reposicionar `Delete` para uma área secundária, separada de `Cancel`.
- [ ] Melhorar o texto de `manual` para algo como `not requested`.
- [ ] Deixar claro que `Open SDD Change` é evolução/auditoria, não a autorização de escrita.
- [ ] Exibir ID e versão da task no topo do modal.
- [ ] Exibir estado de carregamento do modal.
- [ ] Exibir feedback de sucesso/erro de forma persistente até o fechamento.

**Critério de saída:** abrir, salvar, cancelar, excluir, rejeitar e aprovar uma task não altera campos que o usuário não mudou; conflitos de versão são visíveis.

---

### Fase 4 — Robustez do grafo e estados de erro

**Objetivo:** evitar que uma falha de rede ou de API derrube a interface inteira.

- [ ] Envolver `initGraph()` em `try/catch`.
- [ ] Verificar `typeof ForceGraph3D` antes de inicializar.
- [ ] Se a biblioteca não carregar, mostrar um painel de erro no lugar do canvas.
- [ ] Manter `loadGraph()` e `loadTasks()` funcionando mesmo sem a biblioteca 3D.
- [ ] Mostrar `Retry` no painel de erro do grafo.
- [ ] Verificar `res.ok` em `loadGraph()`.
- [ ] Trocar o overlay “Loading...” por estados `loading`, `ready`, `empty`, `error`.
- [ ] Diferenciar grafo vazio de falha de carregamento.
- [ ] Mostrar mensagem de erro no board quando `/api/tasks` falhar.
- [ ] Adicionar um botão de retry que recarregue apenas a visão afetada.
- [ ] Evitar múltiplos polls concorrentes; ignorar resposta antiga quando houver uma mais nova.
- [ ] Corrigir `renderFilters()` para marcar como ativo o `activeFilter` atual.
- [ ] Se o tipo ativo sumir do grafo, voltar para `All` e reaplicar o filtro.
- [ ] Fazer `renderLegend()` exibir todos os tipos ou uma lista expansível; não cortar silenciosamente em 10.
- [ ] Mostrar contagem por tipo na legenda.
- [ ] Adicionar transição/estado visual para nó selecionado e links.
- [ ] Exibir estado de carregamento no painel de detalhes ao selecionar um nó.
- [ ] Tratar erro ao buscar detalhes/relacionamentos de um nó.
- [ ] Se o nó selecionado for filtrado, limpar a seleção ou indicar que ele está oculto.

#### Operação offline

- [ ] Vendorizar `3d-force-graph` em vez de depender de `unpkg.com`.
- [ ] Adicionar o asset local ao build (`dist`).
- [ ] Criar rota local para servir o asset com `Content-Type` correto.
- [ ] Atualizar a CSP para remover `https://unpkg.com` de `script-src`.
- [ ] Testar o dashboard com a rede desabilitada.
- [ ] Se o asset local não for viável nesta rodada, manter a fase 4 como fallback obrigatório e abrir item separado para o vendor.

**Critério de saída:** bloquear `unpkg.com` ou desligar a rede não impede o Kanban, a lista de nós e as APIs; o grafo mostra erro claro ou funciona com asset local.

---

### Fase 5 — Melhorias de UX e hierarquia visual

**Objetivo:** reduzir densidade, melhorar leitura e dar contexto às ações.

- [ ] Agrupar a toolbar do Kanban em blocos: busca, vínculos, estado, escopo, ordenação e ações.
- [ ] Adicionar separadores visuais entre grupos.
- [ ] Adicionar contagem “Mostrando X de Y tasks”.
- [ ] Adicionar estado vazio por coluna com ação contextual.
- [ ] Adicionar estado vazio global quando não houver tasks.
- [ ] Adicionar um resumo dos filtros ativos.
- [ ] Reduzir a quantidade de badges por card; priorizar prioridade, aprovação, integração e target.
- [ ] Mostrar um trecho da descrição ou do goal no card.
- [ ] Aumentar a legibilidade dos badges de 9px para pelo menos 11px.
- [ ] Melhorar o contraste de textos secundários.
- [ ] Remover a duplicação do título “SDD Knowledge Graph” entre topbar e sidebar.
- [ ] Transformar a metadata do painel de detalhes em seções legíveis; manter JSON apenas como opção avançada.
- [ ] Adicionar botão para copiar o ID do nó.
- [ ] Adicionar links clicáveis para nós relacionados no painel de detalhes.
- [ ] Padronizar o vocabulário: `Target backlog`, `Not requested`, `Change (evolution)`.
- [ ] Reorganizar as ações do modal: ação primária, ações secundárias e destrutivas separadas.
- [ ] Adicionar feedback global de operações (toast ou faixa persistente).
- [ ] Exibir o estado de carregamento sem esconder o board já carregado.
- [ ] Não usar apenas cor para indicar prioridade ou status; usar texto/rótulo.

**Critério de saída:** uma pessoa consegue entender o estado do board, aplicar um filtro, abrir uma task e identificar a ação principal sem depender de badges minúsculos.

---

### Fase 6 — Acessibilidade

**Objetivo:** permitir uso completo por teclado e por leitores de tela.

#### Modal

- [ ] Adicionar `role="dialog"` e `aria-modal="true"`.
- [ ] Associar `aria-labelledby` ao título do modal.
- [ ] Mover o foco para o primeiro campo ao abrir.
- [ ] Prender o foco dentro do modal.
- [ ] Fechar com `Escape`.
- [ ] Restaurar o foco ao elemento que abriu o modal.
- [ ] Não fechar por backdrop quando houver alterações não salvas sem confirmação.
- [ ] Marcar erros de validação com `aria-invalid` e mensagem associada.

#### Tabs e filtros

- [ ] Usar `role="tablist"`, `role="tab"` e `aria-selected` nas abas.
- [ ] Associar cada aba ao seu painel com `aria-controls`.
- [ ] Implementar navegação por setas entre abas.
- [ ] Usar `<label for>` ou `aria-label` nos selects e inputs do toolbar.
- [ ] Garantir foco visível em todos os controles.

#### Cards e lista de nós

- [ ] Tornar cards focáveis com `tabindex="0"`.
- [ ] Abrir a task com `Enter` e `Espaço`.
- [ ] Tornar itens da lista de nós focáveis e acionáveis por teclado.
- [ ] Oferecer alternativa ao drag-and-drop: o select `Column` do modal já permite mover; documentar e testar.
- [ ] Adicionar `aria-label` nos botões somente com ícone/símbolo.
- [ ] Adicionar uma região `aria-live` para mensagens de status e erros.
- [ ] Fornecer texto alternativo/instrução para o canvas 3D e manter a lista de nós como alternativa navegável.
- [ ] Respeitar `prefers-reduced-motion` para transições e animação do grafo.

**Critério de saída:** é possível navegar pelas abas, abrir uma task, editar, salvar, cancelar e mover uma task usando apenas teclado, com foco visível e leitura correta.

---

### Fase 7 — Responsividade e layout

**Objetivo:** manter o dashboard utilizável em telas menores sem esconder funcionalidades.

- [ ] Usar `100dvh` no lugar de `100vh` onde necessário.
- [ ] Adicionar breakpoint em `1200px`: reduzir sidebars e detalhes.
- [ ] Adicionar breakpoint em `900px`: transformar detalhes em drawer/painel colapsável.
- [ ] Adicionar breakpoint em `700px`: topbar com wrap, sidebar colapsável e toolbar em blocos.
- [ ] Garantir que o board tenha rolagem horizontal própria em telas estreitas.
- [ ] Manter headers de coluna visíveis durante a rolagem vertical.
- [ ] Garantir que o modal caiba em `92vw` e `88dvh`.
- [ ] Fixar as ações do modal no rodapé em telas pequenas.
- [ ] Aumentar áreas de toque dos botões para pelo menos 36–44px.
- [ ] Evitar overflow horizontal da página.
- [ ] Testar em 1280px, 1024px, 768px e 390px.
- [ ] Testar com zoom de 200%.
- [ ] Não esconder filtros essenciais no mobile; usar um botão “Filters” com painel.

**Critério de saída:** em 390px de largura, é possível ver o board, rolar colunas, abrir o modal e salvar sem conteúdo cortado ou overflow da página.

---

### Fase 8 — Testes, documentação e verificação final

**Objetivo:** cobrir as regressões e provar que a correção funciona.

#### Testes de API e domínio

- [ ] `/api/tasks` devolve `metadata`, `priority`, `approval`, `integration_status`, `created_at`, `updated_at` e `links`.
- [ ] `/api/graph` continua devolvendo o resumo leve, sem exigir metadata.
- [ ] `TaskBoardItem.links` inclui `node_type` e `node_name`.
- [ ] Busca por goal, arquivo e nome de nó vinculado funciona.
- [ ] Filtros `linked`, `unlinked` e por tipo funcionam com links reais.
- [ ] Ordenação por prioridade, nome, criação, atualização, links e integração funciona.
- [ ] Atualização com `expected_version` correto passa.
- [ ] Atualização com `expected_version` antigo retorna `409`.
- [ ] Editar uma task sem alterar campos não apaga goal/files/priority/aprovação.
- [ ] Aprovação, rejeição, Change e integração atualizam o board.
- [ ] `/api/graph` indisponível não impede `/api/tasks`.
- [ ] `/api/tasks` indisponível mostra erro e não apaga o board atual.

#### Testes de UI/shell

- [ ] O HTML não contém `unpkg.com` após o vendor.
- [ ] O HTML referencia o asset local do grafo.
- [ ] O input de busca não é inicializado com `"all"`.
- [ ] O Kanban não usa `allLinks` para filtros de vínculo.
- [ ] O Kanban usa `task.links`.
- [ ] O modal tem `role="dialog"`, `aria-modal` e `aria-labelledby`.
- [ ] As abas têm semântica ARIA.
- [ ] O CSS contém breakpoints para 1200px, 900px e 700px.
- [ ] O shell HTML continua com tags balanceadas.

#### Teste manual em navegador

- [ ] Abrir `/sdd viz` com board vazio.
- [ ] Criar uma task com goal, arquivos, prioridade alta e vínculo.
- [ ] Editar a task, salvar sem mudanças e confirmar que os dados continuam iguais.
- [ ] Editar goal, arquivos e prioridade e confirmar persistência.
- [ ] Buscar por nome, goal, arquivo e nome do nó vinculado.
- [ ] Aplicar cada filtro e combinar filtros.
- [ ] Ordenar por todas as opções e confirmar que o board não trava.
- [ ] Verificar contador de integração e badge de target backlog.
- [ ] Mover card entre colunas e confirmar persistência.
- [ ] Aprovar, rejeitar e excluir com confirmação.
- [ ] Abrir Change e confirmar atualização do badge.
- [ ] Selecionar um tipo no grafo e esperar o poll; confirmar que o botão ativo permanece correto.
- [ ] Desabilitar a rede e confirmar que o Kanban continua funcional.
- [ ] Navegar por teclado: abas, cards, modal, salvar e cancelar.
- [ ] Testar 390px, 768px e 1280px.
- [ ] Testar zoom de 200%.

#### Comandos de verificação

```bash
bun test tests/tasks-api.test.ts
bun test tests/dashboard-ui.test.ts
bun run typecheck
bun run lint
bun run build
git diff --check
```

- [ ] Se houver teste novo de UI, rodá-lo isoladamente.
- [ ] Rodar a suíte completa ao final.
- [ ] Rodar `bun run build` e verificar que o asset local do grafo foi copiado.
- [ ] Verificar `git diff --check` sem erros de whitespace.
- [ ] Registrar os resultados no final deste arquivo.
- [ ] Não criar commit nem push sem pedido explícito.

**Critério de saída:** todos os testes obrigatórios passam, o build inclui o asset local e o checklist manual foi executado ou explicitamente registrado como pendente.

---

### Fase 9 — Feedback inline dos comandos `/sdd`

**Objetivo:** padronizar um retorno curto, imediato e com significado para os comandos determinísticos, sem transformar a confirmação em uma decisão da IA.

#### 9.1 Diagnóstico atual

- [ ] Confirmar no código que todos os subcomandos de `/sdd` são roteados por `runSddCommand` e executam handlers locais, sem LLM para decidir o efeito.
- [ ] Confirmar que o caminho V2 entrega o resultado com `ctx.session.synthetic({ resume: false })`, sem prompt ao modelo.
- [ ] Confirmar que `tests/v2-sdk.test.ts` já verifica `synthetics.length === 1` e `prompts.length === 0` para `/sdd status`.
- [ ] Confirmar que o fallback `ctx.session.prompt` só é usado quando `synthetic` não está disponível.
- [ ] Confirmar que `rewriteSddCommandMessages` substitui o comando bruto pelo resultado determinístico no histórico do modelo.
- [ ] Registrar que `/sdd on` e `/sdd off` atualmente retornam várias linhas, incluindo `changed_at` e o caminho de `.sdd/enabled`.
- [ ] Registrar que os demais comandos também retornam texto completo, mas alguns já são naturalmente curtos.
- [ ] Registrar que um turno de LLM para confirmar uma ação já efetivada adiciona latência e custo, além de permitir que o modelo acrescente fatos que o handler não produziu.

#### 9.2 Decisão de contrato

- [ ] Manter o efeito dos comandos 100% determinístico: o handler decide e executa; a IA nunca decide se o comando foi efetivado.
- [ ] Usar `synthetic` como caminho padrão de entrega inline; ele já evita um turno de LLM.
- [ ] Adicionar um campo `inline` ao resultado do comando, separado do texto completo usado no contexto.
- [ ] Fazer `inline` cair para o texto completo quando não houver versão curta segura.
- [ ] Manter o texto completo em `text` para o histórico do modelo, auditoria e diagnóstico.
- [ ] Exibir `inline` no `synthetic`; manter `text` em `renderSddCommandMessage`/`rewriteSddCommandMessages`.
- [ ] Usar LLM somente no fallback de host sem `synthetic`, com uma instrução de confirmação de uma linha, sem ferramentas e sem permissão para reexecutar o comando.
- [ ] Não transformar `/sdd on` e `/sdd off` em comandos que dependem de LLM para funcionar.
- [ ] Não criar um segundo turno de IA só para “confirmar” um comando que já produziu sua própria confirmação.
- [ ] Manter o idioma e o tom atuais do produto; não introduzir i18n nesta fase.

#### 9.3 Contrato técnico proposto

- [ ] Estender `SddCommandResult` com `inline: string`.
- [ ] Estender a entrada de `SDD_SUBCOMMANDS` com um formatador opcional `inline?: (result: string) => string`.
- [ ] Em `runSddCommand`, retornar `{ matched, text, inline: entry.inline?.(text) ?? text }`.
- [ ] Em `sddOn` e `sddOff`, manter o texto completo atual e fornecer uma versão curta com a consequência da ação.
- [ ] Em `sddStatus`, fornecer uma versão de uma linha com o estado atual e, se possível, o `changed_at`.
- [ ] Em `sddRenew`, fornecer uma versão curta de sucesso ou falha.
- [ ] Em `sddCacheReset`, fornecer uma versão curta com o que foi limpo.
- [ ] Em `sddViz`, fornecer uma versão curta com a URL ou o motivo da indisponibilidade.
- [ ] Em `sddTasks`, manter o relatório completo; usar uma linha curta apenas quando a ação for `board` ou uma aprovação/rejeição.
- [ ] Em `sddExport`, manter o relatório de exportação/dry-run; ele contém dados que não podem ser truncados.
- [ ] Em `sddAcceptance` e `sddGuide`, manter o resultado completo quando ele contiver IDs/status necessários.
- [ ] No comando V2, trocar `text: result.text` por `text: result.inline` no `synthetic`.
- [ ] No fallback, montar um prompt fechado: “The SDD command was already executed. Do not call tools. Reply with one short sentence confirming exactly this result: ...”.
- [ ] No fallback, não enviar o texto completo se ele contiver detalhes operacionais desnecessários; enviar `inline` + o resultado essencial.
- [ ] Garantir que o fallback não execute novamente o comando nem escreva no toggle.
- [ ] Documentar que `inline` é uma conveniência de apresentação; a fonte de verdade continua sendo `text` e o estado persistido.

#### 9.4 Matriz de comandos

| Comando | Precisa de LLM para efetivar? | Retorno inline recomendado | Observação |
|---|---|---|---|
| `/sdd` / `/sdd panel` | Não | Manter painel completo | Texto de ajuda não deve ser resumido a ponto de perder subcomandos |
| `/sdd on` | Não | “SDD enforcement enabled. Code changes now require an approved task.” | Incluir a consequência, não só “OK” |
| `/sdd off` | Não | “SDD enforcement disabled. Code changes are free; use /sdd on to re-enable.” | Incluir como reativar |
| `/sdd status` | Não | “SDD enforcement is ON since ...” | Uma linha; detalhes em `synthetic` completo se necessário |
| `/sdd renew` | Não | “Workflow renewed for 30 min (CHG-001).” | Em falha, mostrar o motivo em uma linha |
| `/sdd cache_reset` | Não | “Cache cleared: memory, disk and snapshot.” | Não listar caminhos internos |
| `/sdd tasks` | Não | Manter lista | Lista é o resultado; não resumir |
| `/sdd tasks integrate` | Não | “N task(s) pending integration.” + brief completo | A integração pela IA é uma ação posterior, não uma confirmação |
| `/sdd tasks board` | Não | “Task board running at URL.” | URL é obrigatória |
| `/sdd tasks approve <ID>` | Não | “Task <ID> approved; declared files are writable.” | Mostrar ID e consequência |
| `/sdd tasks reject <ID>` | Não | “Task <ID> rejected; files remain blocked.” | Mostrar ID e consequência |
| `/sdd tasks change <ID>` | Não | “Change <ID> is <STATUS>.” | Indicar próximo passo se houver blocker |
| `/sdd export <dir>` | Não | “Exported N tasks to <dir>.” | Dry-run deve dizer “preview only” |
| `/sdd acceptance ...` | Não | Manter status/ID resultante | Critérios exigem precisão |
| `/sdd guide <NODE-ID> ...` | Não | “Guidance created: <GUIDANCE-ID>.” | ID é obrigatório |
| `/sdd viz` | Não | “Dashboard running at URL.” | URL é obrigatória |
| `/sdd viz stop` | Não | “Dashboard stopped.” | Se não estiver rodando, “Dashboard was not running.” |

#### 9.5 Checklists de implementação

- [ ] Adicionar `inline` ao contrato de resultado.
- [ ] Adicionar o formatador opcional à tabela de subcomandos.
- [ ] Implementar o fallback `inline` para `text` em todos os comandos sem formatador.
- [ ] Implementar mensagens curtas para `on`, `off`, `status`, `renew`, `cache_reset`, `viz`, `viz stop`, `tasks board` e aprovação/rejeição de task.
- [ ] Manter `text` completo para o histórico do modelo.
- [ ] Atualizar o comando V2 para enviar `inline` ao `synthetic`.
- [ ] Atualizar o fallback de `synthetic` para usar a instrução fechada de uma linha.
- [ ] Garantir que o fallback não tenha efeito colateral e não chame ferramentas.
- [ ] Garantir que o comando já efetivado não seja executado duas vezes se o fallback falhar.
- [ ] Adicionar limite de tamanho para a confirmação de `on`/`off` (por exemplo, uma ou duas linhas).
- [ ] Não truncar listas, IDs, paths de exportação, critérios ou URLs.
- [ ] Atualizar `README.md` para explicar a diferença entre confirmação inline e detalhe operacional.
- [ ] Atualizar o system prompt para o agente não repetir confirmações de comandos já executados.
- [ ] Manter a descrição do comando como “deterministic, no LLM needed”.
- [ ] Adicionar teste de que `/sdd on` e `/sdd off` continuam escrevendo o toggle.
- [ ] Adicionar teste de que o `inline` de `on` contém “enabled” e a consequência.
- [ ] Adicionar teste de que o `inline` de `off` contém “disabled” e como reativar.
- [ ] Adicionar teste de que `synthetic` recebe `inline` e que `prompts.length === 0` no caminho normal.
- [ ] Adicionar teste de fallback em que `synthetic` lança erro e `prompt` recebe a instrução fechada.
- [ ] Adicionar teste de que o fallback não chama `runSddCommand` novamente.
- [ ] Adicionar teste de que o texto completo continua disponível em `renderSddCommandMessage`.
- [ ] Adicionar teste de que todos os subcomandos retornam `inline` não vazio.
- [ ] Adicionar teste de que `on`/`off` não dependem de LLM para efetivar o estado.
- [ ] Rodar `bun test tests/sdd-command.test.ts tests/v2-sdk.test.ts`.
- [ ] Rodar `bun run typecheck`.

#### 9.6 Critério de saída

- [ ] `/sdd on` e `/sdd off` respondem inline em uma ou duas linhas, com a consequência da ação, sem turno de LLM no caminho normal.
- [ ] O estado do toggle é alterado mesmo que o retorno visual falhe.
- [ ] O fallback por LLM, quando necessário, responde apenas com a confirmação e não reexecuta o comando.
- [ ] Nenhum comando determinístico passa a depender de LLM para decidir ou aplicar seu efeito.
- [ ] Os testes existentes de `synthetic` e `prompts.length === 0` continuam passando.

---

## 4. Arquivos previstos

| Arquivo | Mudança |
|---|---|
| `src/server/ui/kanban-view.ts` | Fonte `/api/tasks`, `allTasks`, filtros por `links`, busca, ordenação, modal seguro, ARIA, confirmações e textos |
| `src/server/server.ts` | `initGraph` resiliente, estados de erro/retry, filtro ativo, legenda completa, asset local e CSP |
| `src/server/tasks-api.ts` | Ajustes de contrato se necessário; preferencialmente sem alteração de dados |
| `src/opencode/command.ts` | Contrato `inline`, formatadores curtos de `on`/`off`/`status` e mensagens com consequência |
| `src/opencode/v2/hooks.ts` | Usar `inline` no `synthetic`; fallback de LLM com instrução fechada e sem reexecução |
| `src/opencode/system-prompt.ts` | Instruir o agente a não repetir confirmações de comandos já executados |
| `src/sdd/tasks/board.ts` | Somente se for necessário expor `node_type`/`node_name` ou reforçar o contrato de `TaskBoardItem` |
| `scripts/copy-ui-assets.cjs` | Copiar o asset local do `3d-force-graph` para `dist` |
| `package.json` | Script de build para copiar assets; dependência de desenvolvimento do grafo, se vendorizado |
| `tests/tasks-api.test.ts` | Testes de contrato, filtros, ordenação, links e edição segura |
| `tests/dashboard-ui.test.ts` | Testes estáticos/de shell da UI, ARIA, busca e ausência de CDN |
| `tests/sdd-command.test.ts` | Regressão do contrato `inline`, mensagens de `on`/`off` e texto completo |
| `tests/v2-sdk.test.ts` | Garantir `synthetic` sem prompt e fallback com instrução fechada |
| `README.md` | Documentar `/api/tasks`, fallback offline e confirmação inline dos comandos |
| `PLANO_CORRECAO_UI_VIZ.md` | Este plano e o registro final de execução |

---

## 5. Ordem de execução e dependências

```text
Fase 0 (baseline)
    ↓
Fase 1 (dados do Kanban)
    ↓
Fase 2 (correções funcionais)
    ↓
Fase 3 (modal e mutações)
    ↓
Fase 4 (robustez do grafo)
    ↓
Fase 5 (UX visual)
    ↓
Fase 6 (acessibilidade)
    ↓
Fase 7 (responsividade)
    ↓
Fase 8 (testes e verificação final)

Fase 9 (feedback /sdd) — independente da UI; pode rodar em paralelo
```

- As fases 1–3 são a correção funcional mínima; não devem ser adiadas.
- A fase 4 pode ser feita em paralelo às fases 2–3, porque mexe no carregamento do grafo.
- As fases 5–7 não devem começar antes de a fonte de dados do Kanban estar correta, para evitar retrabalho.
- A fase 9 é independente da UI e pode ser executada em paralelo; ela mexe apenas no contrato de retorno dos comandos e na entrega V2.
- Cada fase deve terminar com teste focado ou verificação manual registrada.

---

## 6. Critérios de aceite

- [ ] O Kanban não lê `allNodes` para montar cards.
- [ ] O Kanban não lê `allLinks` para filtros de vínculo.
- [ ] O Kanban usa `/api/tasks` e exibe metadata completa.
- [ ] Editar e salvar uma task existente não apaga goal, arquivos, prioridade ou aprovação.
- [ ] Busca vazia aparece vazia no boot e depois de `Clear`.
- [ ] “Linked”, “Unlinked” e filtros por tipo retornam os cards corretos.
- [ ] Ordenar por `Created`, `Updated`, `Links`, `Priority` e `Integration` não lança erro.
- [ ] Filtro de escopo e badge target backlog funcionam.
- [ ] Contador de tasks pendentes e de Changes funciona.
- [ ] O botão de filtro ativo do grafo permanece correto após o poll.
- [ ] Falha de `/api/graph` não impede o Kanban.
- [ ] Falha de `/api/tasks` mostra erro e não apaga o board atual.
- [ ] O dashboard funciona sem internet ou com a CDN bloqueada.
- [ ] O modal é navegável por teclado, fecha com `Escape` e prende o foco.
- [ ] Cards e lista de nós são acionáveis por teclado.
- [ ] O layout funciona em 390px, 768px e 1280px sem overflow da página.
- [ ] `/sdd on` e `/sdd off` devolvem confirmação inline curta, com a consequência da ação.
- [ ] O caminho normal de comando usa `synthetic` e não dispara `session.prompt`.
- [ ] O fallback por LLM confirma sem reexecutar o comando e sem chamar ferramentas.
- [ ] `tests/sdd-command.test.ts` e `tests/v2-sdk.test.ts` passam.
- [ ] `bun test` passa.
- [ ] `bun run typecheck` passa.
- [ ] `bun run lint` passa.
- [ ] `bun run build` passa e inclui o asset local do grafo.
- [ ] `git diff --check` passa.
- [ ] Nenhum commit ou push foi criado sem pedido.

---

## 7. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| `/api/tasks` carregar o grafo inteiro e ficar lento em projetos grandes | Carregar tasks sob demanda ao abrir o Kanban; se necessário, adicionar paginação/filtros server-side em fase futura |
| Duplicação de dados entre `allNodes` e `allTasks` | Separar explicitamente as responsabilidades e nunca usar um no lugar do outro |
| Modal continuar enviando campos não editados | Usar task completa + `expected_version`; testar salvamento sem alterações |
| Filtros antigos salvos com `"all"` na busca | Sanitizar `localStorage` na inicialização |
| Conflito entre edição local e alteração do agente | `expected_version` + mensagem de conflito + recarga |
| Asset local do grafo não ser copiado para `dist` | Testar `bun run build` e a rota do asset no pacote final |
| Correção de acessibilidade quebrar o layout | Focar em semântica e foco; validar visualmente em desktop e mobile |
| Falta de navegador no ambiente de desenvolvimento | Usar testes de shell/API + checklist manual em navegador; não declarar teste visual como executado sem evidência |
| Aumento de escopo para redesenho completo | Manter este plano limitado a correções e melhorias incrementais; redesenho visual amplo fica para outro ciclo |
| Confirmação por LLM adicionar latência, custo e hallucination | Manter `synthetic` determinístico como padrão; usar LLM apenas no fallback, com instrução fechada e uma linha |
| Resumo curto esconder informação necessária | Usar `inline` apenas onde há versão segura; manter listas, IDs, paths, critérios e URLs completos |

---

## 8. Registro de execução

Preencher ao final de cada fase, sem marcar como concluído o que não foi verificado.

| Fase | Status | Testes/verificações | Observações |
|---|---|---|---|
| 0 — Baseline | concluída | suíte focada e typecheck | Baseline registrado durante a execução; os testes de contrato, edição segura, filtros e scripts inline foram adicionados. |
| 1 — Kanban `/api/tasks` | concluída | `tests/tasks-api.test.ts` | `allTasks` é a fonte do board; `/api/graph` continuou leve. |
| 2 — Funcional | concluída | testes de API + inspeção do HTML | Busca, filtros por `links`, ordenação, contadores e badges usam `TaskBoardItem`. |
| 3 — Modal/mutações | concluída | testes de `expected_version` e edição seletiva | Modal usa task completa, envia só campos alterados, confirma ações destrutivas e sincroniza versão após mutações. |
| 4 — Grafo/erros | concluída | teste do asset local e sintaxe dos scripts | `3d-force-graph` é servido por `/ui/3d-force-graph.min.js`; CSP sem CDN; painel de erro e retry. |
| 5 — UX visual | concluída | inspeção de HTML/CSS | Toolbar agrupada, resumo de filtros, contagem, estado vazio, badges legíveis e ações do modal separadas. |
| 6 — Acessibilidade | concluída | testes estáticos de ARIA | `role=dialog`, `aria-modal`, foco preso/Escape, tabs com setas, cards e nós acionáveis por teclado. |
| 7 — Responsividade | implementada; validação visual pendente | breakpoints e inspeção de CSS | Breakpoints em 1200/900/700px, board com rolagem, modal em `92vw`/`88dvh`; sem navegador disponível para testar 390/768/1280px ou zoom 200%. |
| 8 — Testes finais | concluída com ressalvas | suíte completa, typecheck, build, `git diff --check` | `bun run lint` não pôde rodar porque o repositório não tem arquivo de configuração do ESLint. |
| 9 — Feedback `/sdd` | concluída | `tests/sdd-command.test.ts`, `tests/v2-sdk.test.ts` | `synthetic` recebe `inline`; fallback usa instrução fechada e não reexecuta o comando. |

### Resultado final

- Versão: `3.4.0` (`package.json`, `marketplace.json` e `src/version.ts` sincronizados).
- `bun test`: **498 pass, 0 fail, 4019 expect() calls** em 34 arquivos.
- `bun test tests/tasks-api.test.ts tests/sdd-command.test.ts tests/v2-sdk.test.ts tests/version-consistency.test.ts`: **96 pass, 0 fail**.
- `bun run typecheck`: passou.
- `bun run lint`: não executou — ESLint 8.57.1 não encontrou arquivo de configuração no repositório.
- `bun run build`: passou; `dist/server/ui/vendor/3d-force-graph.min.js` copiado.
- `git diff --check`: passou sem erros de whitespace.
- Commit/push: realizados após este registro (consulte o histórico do Git).
- Pendências conhecidas: validação visual manual em navegador (390px, 768px, 1280px, zoom 200%, teclado real) e configuração de ESLint para que `bun run lint` funcione.
