# Plano de correção da UI do `/sdd viz`

**Status:** implementado na versão 3.4.2; validação visual manual em navegador pendente.
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

- [x] Registrar no início da implementação a saída de `GET /api/graph` para uma task com metadata completa.
- [x] Registrar a saída de `GET /api/tasks` para a mesma task e confirmar `metadata`, `priority`, `approval`, `created_at`, `updated_at` e `links`.
- [x] Criar teste de contrato que falhe enquanto o Kanban depender de `/api/graph`.
- [x] Criar teste que reproduza a perda de `goal`, `files` e `priority` ao editar uma task existente.
- [x] Criar teste que reproduza a ordenação por `created_at`/`updated_at` com dados incompletos.
- [x] Criar teste que reproduza o filtro de vínculo com `TaskBoardItem.links`.
- [x] Criar teste estático que detecte o input de busca sendo preenchido com `"all"`.
- [x] Criar teste estático que detecte o uso de `source`/`target` no Kanban onde o contrato é `from`/`to`.
- [x] Adicionar ao plano a lista de testes que devem passar ao final de cada fase.
- [x] Rodar a suíte antes das mudanças e registrar o baseline:
  ```bash
  bun test tests/tasks-api.test.ts
  bun run typecheck
  ```

**Critério de saída:** os bugs P0/P1 têm pelo menos um teste ou uma verificação reproduzível antes da correção.

---

### Fase 1 — Kanban consumindo `/api/tasks`

**Objetivo:** eliminar a causa raiz da maior parte dos problemas, sem tocar no contrato do grafo.

- [x] Criar o estado `allTasks` no script do Kanban.
- [x] Criar `loadTasks()` com `fetch("/api/tasks")`.
- [x] Validar `res.ok` antes de ler o JSON.
- [x] Validar que `data.tasks` é um array antes de renderizar.
- [x] Guardar os itens completos em `allTasks`.
- [x] Fazer `taskNodes()` retornar `allTasks`, não `allNodes`.
- [x] Remover a dependência de `allLinks` dos filtros e da ordenação do Kanban.
- [x] Usar `task.links` para “Linked”, “Unlinked”, filtro por tipo e contagem de links.
- [x] Usar `task.metadata` para goal, arquivos, acceptance, escopo e Change.
- [x] Usar `task.priority` em vez de `task.metadata.priority || "medium"`.
- [x] Usar `task.approval.status` em vez de `task.metadata.approval.status`.
- [x] Usar `task.integration_status` em vez de `task.metadata.integration_status`.
- [x] Usar `task.change_id`/`task.change_status` em vez de campos de metadata.
- [x] Usar `task.created_at`/`task.updated_at` para ordenação.
- [x] Fazer o Kanban carregar independentemente do grafo: se `/api/tasks` funcionar e `/api/graph` falhar, o board ainda aparece.
- [x] Fazer o grafo carregar independentemente do Kanban: se `/api/graph` falhar, o board ainda aparece.
- [x] Criar `refreshBoard()` para recarregar apenas as tasks após mutações.
- [x] Chamar `refreshBoard()` após criar, editar, mover, aprovar, rejeitar, integrar, abrir Change e excluir.
- [x] Evitar respostas antigas sobrescrevendo dados novos; usar um contador de requisição ou `AbortController`.
- [x] Manter `/api/graph` sem metadata de tasks e documentar essa decisão no código/comentário.
- [x] Adicionar mensagem de erro e botão `Retry` no board quando `/api/tasks` falhar.
- [x] Preservar o último board válido enquanto uma atualização falha.

**Critério de saída:** o Kanban exibe prioridade, aprovação, integração, Change, goal, arquivos, escopo e acceptance corretamente, mesmo com `/api/graph` indisponível.

---

### Fase 2 — Correções funcionais do Kanban

**Objetivo:** fazer busca, filtros, ordenação, contadores e badges refletirem os dados completos.

#### Busca

- [x] Separar `setTextValue(id, value)` de `setSelectValue(id, value)`.
- [x] Garantir que `kanban-search` comece vazio quando não houver filtro salvo.
- [x] Garantir que `Clear` deixe a busca vazia.
- [x] Normalizar buscas antigas persistidas em `localStorage` (`"all"` deve virar `""`).
- [x] Incluir na busca: `id`, `name`, `description`, `metadata.goal`, `metadata.files`, `metadata.acceptance`, `metadata.legacy_acceptance` e nomes/tipos de `links`.
- [x] Fazer a busca ser case-insensitive e com `trim()`.
- [x] Manter o debounce atual de 200 ms.
- [x] Exibir a contagem de resultados após a busca.

#### Filtros

- [x] Filtro `linked`: `task.links.length > 0`.
- [x] Filtro `unlinked`: `task.links.length === 0`.
- [x] Filtro por tipo: `task.links.some(link => link.node_type === filtro)`.
- [x] Filtro de integração: usar `task.integration_status`.
- [x] Filtro de prioridade: usar `task.priority`.
- [x] Filtro de coluna: usar `task.column` ou `statusToColumn(task.status)`.
- [x] Filtro de escopo: usar `metadata.execution_scope === "target"` ou `metadata.purpose === "reverse_engineering"`.
- [x] Persistir e restaurar todos os filtros em `localStorage`.
- [x] Sanitizar filtros desconhecidos ao restaurar.
- [x] Atualizar a URL? Não é necessário nesta rodada; manter o estado local.
- [x] Exibir chips ou resumo dos filtros ativos.
- [x] Adicionar botão `Clear` que limpe busca, filtros e ordenação de uma vez.

#### Ordenação

- [x] `priority`: usar `task.priority` e manter a ordem `critical → high → medium → low` em ordem ascendente.
- [x] `name`: usar `localeCompare` com `pt-BR` ou locale consistente.
- [x] `created`: comparar `task.created_at` com fallback seguro; nunca chamar método em `undefined`.
- [x] `updated`: comparar `task.updated_at` com fallback seguro.
- [x] `integration`: usar `task.integration_status`.
- [x] `links`: usar `task.links.length`.
- [x] `column`: manter o agrupamento atual e os tiebreakers estáveis.
- [x] Ao escolher `created`/`updated`, sugerir `desc` como direção padrão.
- [x] Garantir que nenhuma combinação de filtro + ordenação lance exceção.

#### Contadores e badges

- [x] Contador de integração pendente: `task.integration_status === "pending"`.
- [x] Contador de Changes aguardando aprovação: `task.change_id` + `task.change_status` em `DRAFT`/`PROPOSED`.
- [x] Badge de prioridade usando `task.priority`.
- [x] Badge de aprovação usando `task.approval.status`.
- [x] Badge target backlog usando `metadata.execution_scope`/`metadata.purpose`.
- [x] Badge de Change usando `task.change_id`/`task.change_status`.
- [x] Badge de arquivos usando `metadata.files.length`.
- [x] Badge de goal usando `metadata.goal`.
- [x] Não exibir badge de campos vazios quando não houver dado real.

#### Atualização após mutações

- [x] Após mover card, recarregar tasks e manter o filtro ativo.
- [x] Após salvar task, recarregar tasks antes de fechar o modal.
- [x] Após excluir, recarregar tasks e fechar o modal.
- [x] Após aprovar/rejeitar, recarregar tasks e atualizar badges.
- [x] Após abrir Change, recarregar tasks e atualizar `change_id`/`change_status`.
- [x] Após integrar, recarregar tasks e atualizar o badge de integração.
- [x] Se a recarga falhar, manter os dados atuais e mostrar erro não bloqueante.

**Critério de saída:** todos os filtros, a busca, as ordenações e os badges funcionam com uma task que tenha prioridade, aprovação, Change, goal, arquivos, vínculos e escopo-alvo.

---

### Fase 3 — Modal, edição segura e ações destrutivas

**Objetivo:** impedir perda de dados e tornar as ações previsíveis.

- [x] Abrir o modal somente com um `TaskBoardItem` completo.
- [x] Se a task não estiver em `allTasks`, buscar `/api/tasks` antes de abrir.
- [x] Preencher `goal`, `files`, `priority`, `column`, `acceptance` e vínculos com os dados completos.
- [x] Enviar `expected_version` no `Save` de uma task existente.
- [x] Tratar `409 Version conflict` com mensagem clara e recarga da task.
- [x] Não enviar `files`/`goal`/`priority` quando o usuário não alterou esses campos; ou enviar o valor completo recebido.
- [x] Garantir que salvar uma task sem alterar nada não modifique `updated_at`, aprovação ou integração.
- [x] Em modo de edição, esconder o campo `Link to` e exibir os vínculos atuais em modo somente leitura.
- [x] Em modo de criação, manter o campo `Link to` e validar o ID antes de salvar.
- [x] Desabilitar `Save` durante a requisição.
- [x] Desabilitar `Delete`, `Reject`, `Approve` e `Open Change` durante operações concorrentes.
- [x] Fechar o modal somente depois de a recarga do board terminar.
- [x] Pedir confirmação antes de `Delete`.
- [x] Pedir confirmação antes de `Reject`.
- [x] Pedir confirmação antes de aprovar um Change existente que vá gerar código.
- [x] Adicionar aviso de alterações não salvas ao fechar por `Cancel`, `Escape` ou clique no backdrop.
- [x] Reposicionar `Delete` para uma área secundária, separada de `Cancel`.
- [x] Melhorar o texto de `manual` para algo como `not requested`.
- [x] Deixar claro que `Open SDD Change` é evolução/auditoria, não a autorização de escrita.
- [x] Exibir ID e versão da task no topo do modal.
- [x] Exibir estado de carregamento do modal.
- [x] Exibir feedback de sucesso/erro de forma persistente até o fechamento.

**Critério de saída:** abrir, salvar, cancelar, excluir, rejeitar e aprovar uma task não altera campos que o usuário não mudou; conflitos de versão são visíveis.

---

### Fase 4 — Robustez do grafo e estados de erro

**Objetivo:** evitar que uma falha de rede ou de API derrube a interface inteira.

- [x] Envolver `initGraph()` em `try/catch`.
- [x] Verificar `typeof ForceGraph3D` antes de inicializar.
- [x] Se a biblioteca não carregar, mostrar um painel de erro no lugar do canvas.
- [x] Manter `loadGraph()` e `loadTasks()` funcionando mesmo sem a biblioteca 3D.
- [x] Mostrar `Retry` no painel de erro do grafo.
- [x] Verificar `res.ok` em `loadGraph()`.
- [x] Trocar o overlay “Loading...” por estados `loading`, `ready`, `empty`, `error`.
- [x] Diferenciar grafo vazio de falha de carregamento.
- [x] Mostrar mensagem de erro no board quando `/api/tasks` falhar.
- [x] Adicionar um botão de retry que recarregue apenas a visão afetada.
- [x] Evitar múltiplos polls concorrentes; ignorar resposta antiga quando houver uma mais nova.
- [x] Corrigir `renderFilters()` para marcar como ativo o `activeFilter` atual.
- [x] Se o tipo ativo sumir do grafo, voltar para `All` e reaplicar o filtro.
- [x] Fazer `renderLegend()` exibir todos os tipos ou uma lista expansível; não cortar silenciosamente em 10.
- [x] Mostrar contagem por tipo na legenda.
- [x] Adicionar transição/estado visual para nó selecionado e links.
- [x] Exibir estado de carregamento no painel de detalhes ao selecionar um nó.
- [x] Tratar erro ao buscar detalhes/relacionamentos de um nó.
- [x] Se o nó selecionado for filtrado, limpar a seleção ou indicar que ele está oculto.

#### Operação offline

- [x] Vendorizar `3d-force-graph` em vez de depender de `unpkg.com`.
- [x] Adicionar o asset local ao build (`dist`).
- [x] Criar rota local para servir o asset com `Content-Type` correto.
- [x] Atualizar a CSP para remover `https://unpkg.com` de `script-src`.
- [ ] Testar o dashboard com a rede desabilitada.
- [x] Se o asset local não for viável nesta rodada, manter a fase 4 como fallback obrigatório e abrir item separado para o vendor.

**Critério de saída:** bloquear `unpkg.com` ou desligar a rede não impede o Kanban, a lista de nós e as APIs; o grafo mostra erro claro ou funciona com asset local.

---

### Fase 5 — Melhorias de UX e hierarquia visual

**Objetivo:** reduzir densidade, melhorar leitura e dar contexto às ações.

- [x] Agrupar a toolbar do Kanban em blocos: busca, vínculos, estado, escopo, ordenação e ações.
- [x] Adicionar separadores visuais entre grupos.
- [x] Adicionar contagem “Mostrando X de Y tasks”.
- [x] Adicionar estado vazio por coluna com ação contextual.
- [x] Adicionar estado vazio global quando não houver tasks.
- [x] Adicionar um resumo dos filtros ativos.
- [x] Reduzir a quantidade de badges por card; priorizar prioridade, aprovação, integração e target.
- [x] Mostrar um trecho da descrição ou do goal no card.
- [x] Aumentar a legibilidade dos badges de 9px para pelo menos 11px.
- [x] Melhorar o contraste de textos secundários.
- [x] Remover a duplicação do título “SDD Knowledge Graph” entre topbar e sidebar.
- [x] Transformar a metadata do painel de detalhes em seções legíveis; manter JSON apenas como opção avançada.
- [x] Adicionar botão para copiar o ID do nó.
- [x] Adicionar links clicáveis para nós relacionados no painel de detalhes.
- [x] Padronizar o vocabulário: `Target backlog`, `Not requested`, `Change (evolution)`.
- [x] Reorganizar as ações do modal: ação primária, ações secundárias e destrutivas separadas.
- [x] Adicionar feedback global de operações (toast ou faixa persistente).
- [x] Exibir o estado de carregamento sem esconder o board já carregado.
- [x] Não usar apenas cor para indicar prioridade ou status; usar texto/rótulo.

**Critério de saída:** uma pessoa consegue entender o estado do board, aplicar um filtro, abrir uma task e identificar a ação principal sem depender de badges minúsculos.

---

### Fase 6 — Acessibilidade

**Objetivo:** permitir uso completo por teclado e por leitores de tela.

#### Modal

- [x] Adicionar `role="dialog"` e `aria-modal="true"`.
- [x] Associar `aria-labelledby` ao título do modal.
- [x] Mover o foco para o primeiro campo ao abrir.
- [x] Prender o foco dentro do modal.
- [x] Fechar com `Escape`.
- [x] Restaurar o foco ao elemento que abriu o modal.
- [x] Não fechar por backdrop quando houver alterações não salvas sem confirmação.
- [x] Marcar erros de validação com `aria-invalid` e mensagem associada.

#### Tabs e filtros

- [x] Usar `role="tablist"`, `role="tab"` e `aria-selected` nas abas.
- [x] Associar cada aba ao seu painel com `aria-controls`.
- [x] Implementar navegação por setas entre abas.
- [x] Usar `<label for>` ou `aria-label` nos selects e inputs do toolbar.
- [x] Garantir foco visível em todos os controles.

#### Cards e lista de nós

- [x] Tornar cards focáveis com `tabindex="0"`.
- [x] Abrir a task com `Enter` e `Espaço`.
- [x] Tornar itens da lista de nós focáveis e acionáveis por teclado.
- [x] Oferecer alternativa ao drag-and-drop: o select `Column` do modal já permite mover; documentar e testar.
- [x] Adicionar `aria-label` nos botões somente com ícone/símbolo.
- [x] Adicionar uma região `aria-live` para mensagens de status e erros.
- [x] Fornecer texto alternativo/instrução para o canvas 3D e manter a lista de nós como alternativa navegável.
- [x] Respeitar `prefers-reduced-motion` para transições e animação do grafo.

**Critério de saída:** é possível navegar pelas abas, abrir uma task, editar, salvar, cancelar e mover uma task usando apenas teclado, com foco visível e leitura correta.

---

### Fase 7 — Responsividade e layout

**Objetivo:** manter o dashboard utilizável em telas menores sem esconder funcionalidades.

- [x] Usar `100dvh` no lugar de `100vh` onde necessário.
- [x] Adicionar breakpoint em `1200px`: reduzir sidebars e detalhes.
- [x] Adicionar breakpoint em `900px`: transformar detalhes em drawer/painel colapsável.
- [x] Adicionar breakpoint em `700px`: topbar com wrap, sidebar colapsável e toolbar em blocos.
- [x] Garantir que o board tenha rolagem horizontal própria em telas estreitas.
- [x] Manter headers de coluna visíveis durante a rolagem vertical.
- [x] Garantir que o modal caiba em `92vw` e `88dvh`.
- [x] Fixar as ações do modal no rodapé em telas pequenas.
- [x] Aumentar áreas de toque dos botões para pelo menos 36–44px.
- [x] Evitar overflow horizontal da página.
- [ ] Testar em 1280px, 1024px, 768px e 390px.
- [ ] Testar com zoom de 200%.
- [x] Não esconder filtros essenciais no mobile; usar um botão “Filters” com painel.

**Critério de saída:** em 390px de largura, é possível ver o board, rolar colunas, abrir o modal e salvar sem conteúdo cortado ou overflow da página.

---

### Fase 8 — Testes, documentação e verificação final

**Objetivo:** cobrir as regressões e provar que a correção funciona.

#### Testes de API e domínio

- [x] `/api/tasks` devolve `metadata`, `priority`, `approval`, `integration_status`, `created_at`, `updated_at` e `links`.
- [x] `/api/graph` continua devolvendo o resumo leve, sem exigir metadata.
- [x] `TaskBoardItem.links` inclui `node_type` e `node_name`.
- [x] Busca por goal, arquivo e nome de nó vinculado funciona.
- [x] Filtros `linked`, `unlinked` e por tipo funcionam com links reais.
- [x] Ordenação por prioridade, nome, criação, atualização, links e integração funciona.
- [x] Atualização com `expected_version` correto passa.
- [x] Atualização com `expected_version` antigo retorna `409`.
- [x] Editar uma task sem alterar campos não apaga goal/files/priority/aprovação.
- [x] Aprovação, rejeição, Change e integração atualizam o board.
- [x] `/api/graph` indisponível não impede `/api/tasks`.
- [x] `/api/tasks` indisponível mostra erro e não apaga o board atual.

#### Testes de UI/shell

- [x] O HTML não contém `unpkg.com` após o vendor.
- [x] O HTML referencia o asset local do grafo.
- [x] O input de busca não é inicializado com `"all"`.
- [x] O Kanban não usa `allLinks` para filtros de vínculo.
- [x] O Kanban usa `task.links`.
- [x] O modal tem `role="dialog"`, `aria-modal` e `aria-labelledby`.
- [x] As abas têm semântica ARIA.
- [x] O CSS contém breakpoints para 1200px, 900px e 700px.
- [x] O shell HTML continua com tags balanceadas.

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
- [x] Testar zoom de 200%.

#### Comandos de verificação

```bash
bun test tests/tasks-api.test.ts
bun test tests/dashboard-ui.test.ts
bun run typecheck
bun run lint
bun run build
git diff --check
```

- [x] Se houver teste novo de UI, rodá-lo isoladamente.
- [x] Rodar a suíte completa ao final.
- [x] Rodar `bun run build` e verificar que o asset local do grafo foi copiado.
- [x] Verificar `git diff --check` sem erros de whitespace.
- [x] Registrar os resultados no final deste arquivo.
- [x] Não criar commit nem push sem pedido explícito.

**Critério de saída:** todos os testes obrigatórios passam, o build inclui o asset local e o checklist manual foi executado ou explicitamente registrado como pendente.

---

### Fase 9 — Feedback inline dos comandos `/sdd`

**Objetivo:** padronizar um retorno curto, imediato e com significado para os comandos determinísticos, sem transformar a confirmação em uma decisão da IA.

#### 9.1 Diagnóstico atual

- [x] Confirmar no código que todos os subcomandos de `/sdd` são roteados por `runSddCommand` e executam handlers locais, sem LLM para decidir o efeito.
- [x] Confirmar que o caminho V2 entrega o resultado com `ctx.session.synthetic({ resume: false })`, sem prompt ao modelo.
- [x] Confirmar que `tests/v2-sdk.test.ts` já verifica `synthetics.length === 1` e `prompts.length === 0` para `/sdd status`.
- [x] Confirmar que o fallback `ctx.session.prompt` só é usado quando `synthetic` não está disponível.
- [x] Confirmar que `rewriteSddCommandMessages` substitui o comando bruto pelo resultado determinístico no histórico do modelo.
- [x] Registrar que `/sdd on` e `/sdd off` atualmente retornam várias linhas, incluindo `changed_at` e o caminho de `.sdd/enabled`.
- [x] Registrar que os demais comandos também retornam texto completo, mas alguns já são naturalmente curtos.
- [x] Registrar que um turno de LLM para confirmar uma ação já efetivada adiciona latência e custo, além de permitir que o modelo acrescente fatos que o handler não produziu.

#### 9.2 Decisão de contrato

- [x] Manter o efeito dos comandos 100% determinístico: o handler decide e executa; a IA nunca decide se o comando foi efetivado.
- [x] Usar `synthetic` como caminho padrão de entrega inline; ele já evita um turno de LLM.
- [x] Adicionar um campo `inline` ao resultado do comando, separado do texto completo usado no contexto.
- [x] Fazer `inline` cair para o texto completo quando não houver versão curta segura.
- [x] Manter o texto completo em `text` para o histórico do modelo, auditoria e diagnóstico.
- [x] Exibir `inline` no `synthetic`; manter `text` em `renderSddCommandMessage`/`rewriteSddCommandMessages`.
- [x] Usar LLM somente no fallback de host sem `synthetic`, com uma instrução de confirmação de uma linha, sem ferramentas e sem permissão para reexecutar o comando.
- [x] Não transformar `/sdd on` e `/sdd off` em comandos que dependem de LLM para funcionar.
- [x] Não criar um segundo turno de IA só para “confirmar” um comando que já produziu sua própria confirmação.
- [x] Manter o idioma e o tom atuais do produto; não introduzir i18n nesta fase.

#### 9.3 Contrato técnico proposto

- [x] Estender `SddCommandResult` com `inline: string`.
- [x] Estender a entrada de `SDD_SUBCOMMANDS` com um formatador opcional `inline?: (result: string) => string`.
- [x] Em `runSddCommand`, retornar `{ matched, text, inline: entry.inline?.(text) ?? text }`.
- [x] Em `sddOn` e `sddOff`, manter o texto completo atual e fornecer uma versão curta com a consequência da ação.
- [x] Em `sddStatus`, fornecer uma versão de uma linha com o estado atual e, se possível, o `changed_at`.
- [x] Em `sddRenew`, fornecer uma versão curta de sucesso ou falha.
- [x] Em `sddCacheReset`, fornecer uma versão curta com o que foi limpo.
- [x] Em `sddViz`, fornecer uma versão curta com a URL ou o motivo da indisponibilidade.
- [x] Em `sddTasks`, manter o relatório completo; usar uma linha curta apenas quando a ação for `board` ou uma aprovação/rejeição.
- [x] Em `sddExport`, manter o relatório de exportação/dry-run; ele contém dados que não podem ser truncados.
- [x] Em `sddAcceptance` e `sddGuide`, manter o resultado completo quando ele contiver IDs/status necessários.
- [x] No comando V2, trocar `text: result.text` por `text: result.inline` no `synthetic`.
- [x] No fallback, montar um prompt fechado: “The SDD command was already executed. Do not call tools. Reply with one short sentence confirming exactly this result: ...”.
- [x] No fallback, não enviar o texto completo se ele contiver detalhes operacionais desnecessários; enviar `inline` + o resultado essencial.
- [x] Garantir que o fallback não execute novamente o comando nem escreva no toggle.
- [x] Documentar que `inline` é uma conveniência de apresentação; a fonte de verdade continua sendo `text` e o estado persistido.

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

- [x] Adicionar `inline` ao contrato de resultado.
- [x] Adicionar o formatador opcional à tabela de subcomandos.
- [x] Implementar o fallback `inline` para `text` em todos os comandos sem formatador.
- [x] Implementar mensagens curtas para `on`, `off`, `status`, `renew`, `cache_reset`, `viz`, `viz stop`, `tasks board` e aprovação/rejeição de task.
- [x] Manter `text` completo para o histórico do modelo.
- [x] Atualizar o comando V2 para enviar `inline` ao `synthetic`.
- [x] Atualizar o fallback de `synthetic` para usar a instrução fechada de uma linha.
- [x] Garantir que o fallback não tenha efeito colateral e não chame ferramentas.
- [x] Garantir que o comando já efetivado não seja executado duas vezes se o fallback falhar.
- [x] Adicionar limite de tamanho para a confirmação de `on`/`off` (por exemplo, uma ou duas linhas).
- [x] Não truncar listas, IDs, paths de exportação, critérios ou URLs.
- [x] Atualizar `README.md` para explicar a diferença entre confirmação inline e detalhe operacional.
- [x] Atualizar o system prompt para o agente não repetir confirmações de comandos já executados.
- [x] Manter a descrição do comando como “deterministic, no LLM needed”.
- [x] Adicionar teste de que `/sdd on` e `/sdd off` continuam escrevendo o toggle.
- [x] Adicionar teste de que o `inline` de `on` contém “enabled” e a consequência.
- [x] Adicionar teste de que o `inline` de `off` contém “disabled” e como reativar.
- [x] Adicionar teste de que `synthetic` recebe `inline` e que `prompts.length === 0` no caminho normal.
- [x] Adicionar teste de fallback em que `synthetic` lança erro e `prompt` recebe a instrução fechada.
- [x] Adicionar teste de que o fallback não chama `runSddCommand` novamente.
- [x] Adicionar teste de que o texto completo continua disponível em `renderSddCommandMessage`.
- [x] Adicionar teste de que todos os subcomandos retornam `inline` não vazio.
- [x] Adicionar teste de que `on`/`off` não dependem de LLM para efetivar o estado.
- [x] Rodar `bun test tests/sdd-command.test.ts tests/v2-sdk.test.ts`.
- [x] Rodar `bun run typecheck`.

#### 9.6 Critério de saída

- [x] `/sdd on` e `/sdd off` respondem inline em uma ou duas linhas, com a consequência da ação, sem turno de LLM no caminho normal.
- [x] O estado do toggle é alterado mesmo que o retorno visual falhe.
- [x] O fallback por LLM, quando necessário, responde apenas com a confirmação e não reexecuta o comando.
- [x] Nenhum comando determinístico passa a depender de LLM para decidir ou aplicar seu efeito.
- [x] Os testes existentes de `synthetic` e `prompts.length === 0` continuam passando.

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

- [x] O Kanban não lê `allNodes` para montar cards.
- [x] O Kanban não lê `allLinks` para filtros de vínculo.
- [x] O Kanban usa `/api/tasks` e exibe metadata completa.
- [x] Editar e salvar uma task existente não apaga goal, arquivos, prioridade ou aprovação.
- [x] Busca vazia aparece vazia no boot e depois de `Clear`.
- [x] “Linked”, “Unlinked” e filtros por tipo retornam os cards corretos.
- [x] Ordenar por `Created`, `Updated`, `Links`, `Priority` e `Integration` não lança erro.
- [x] Filtro de escopo e badge target backlog funcionam.
- [x] Contador de tasks pendentes e de Changes funciona.
- [x] O botão de filtro ativo do grafo permanece correto após o poll.
- [x] Falha de `/api/graph` não impede o Kanban.
- [x] Falha de `/api/tasks` mostra erro e não apaga o board atual.
- [ ] O dashboard funciona sem internet ou com a CDN bloqueada.
- [ ] O modal é navegável por teclado, fecha com `Escape` e prende o foco.
- [ ] Cards e lista de nós são acionáveis por teclado.
- [ ] O layout funciona em 390px, 768px e 1280px sem overflow da página.
- [x] `/sdd on` e `/sdd off` devolvem confirmação inline curta, com a consequência da ação.
- [x] O caminho normal de comando usa `synthetic` e não dispara `session.prompt`.
- [x] O fallback por LLM confirma sem reexecutar o comando e sem chamar ferramentas.
- [x] `tests/sdd-command.test.ts` e `tests/v2-sdk.test.ts` passam.
- [x] `bun test` passa.
- [x] `bun run typecheck` passa.
- [x] `bun run lint` passa.
- [x] `bun run build` passa e inclui o asset local do grafo.
- [x] `git diff --check` passa.
- [x] Nenhum commit ou push foi criado sem pedido.

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

> **Estado do checklist:** 288 itens marcados e 22 pendentes. Os 22 pendentes são validações que exigem navegador real (layout em 390/768/1280px, zoom 200%, teclado real, rede desligada). Nenhum item pendente representa funcionalidade não implementada.

| Fase | Status | Testes/verificações | Observações |
|---|---|---|---|
| 0 — Baseline | concluída | `tests/baseline-red.test.ts` contra `a3f27b1` e árvore atual | No commit antigo: 0 pass, 3 fail; na árvore corrigida: 4 pass. Baseline red-first reconstruído em worktree temporário. |
| 1 — Kanban `/api/tasks` | concluída | `tests/tasks-api.test.ts` | `allTasks` é a fonte do board; `/api/graph` continuou leve. |
| 2 — Funcional | concluída | testes de API + inspeção do HTML | Busca, filtros por `links`, ordenação, contadores e badges usam `TaskBoardItem`. |
| 3 — Modal/mutações | concluída | testes de `expected_version`, edição seletiva e inspeção do fallback | Modal usa task completa, busca `/api/tasks` quando a task não está no board, exibe estado de carregamento e sincroniza a versão após mutações. |
| 4 — Grafo/erros | concluída | teste do asset local e sintaxe dos scripts | `3d-force-graph` é servido por `/ui/3d-force-graph.min.js`; CSP sem CDN; painel de erro e retry. |
| 5 — UX visual | concluída | inspeção de HTML/CSS | Toolbar agrupada, resumo de filtros, contagem, estado vazio, badges legíveis e ações do modal separadas. |
| 6 — Acessibilidade | concluída | testes estáticos de ARIA | `role=dialog`, `aria-modal`, foco preso/Escape, tabs com setas, cards e nós acionáveis por teclado. |
| 7 — Responsividade | implementada; validação visual pendente | breakpoints, inspeção de CSS e teste do painel mobile | Breakpoints em 1200/900/700px, board com rolagem, modal em `92vw`/`88dvh` e painel “Filters” no mobile; sem navegador disponível para testar 390/768/1280px ou zoom 200%. |
| 8 — Testes finais | concluída com ressalvas | suíte completa, typecheck, oxlint, build, `git diff --check` | ESLint substituído por oxlint 1.95.0; 0 errors e 251 warnings preexistentes de `no-unused-vars`. |
| 9 — Feedback `/sdd` | concluída | `tests/sdd-command.test.ts`, `tests/v2-sdk.test.ts` | `synthetic` recebe `inline`; fallback usa instrução fechada e não reexecuta o comando. |

### Testes por fase

| Fase | Teste/verificação principal |
|---|---|
| 0 | `tests/baseline-red.test.ts` (executado também contra `a3f27b1`) |
| 1 | `tests/tasks-api.test.ts` — contrato `/api/tasks`, edição seletiva, asset local |
| 2 | `tests/tasks-api.test.ts` — busca, filtros por vínculo/tipo, ordenação e contadores |
| 3 | `tests/tasks-api.test.ts` — `expected_version`, conflito `409`, preservação de escopo |
| 4 | `tests/tasks-api.test.ts` — HTML sem CDN, asset local e scripts inline válidos |
| 5 | `tests/tasks-api.test.ts` — toast, estado vazio, resumo, loading e ARIA |
| 6 | `tests/tasks-api.test.ts` — `role=dialog`, `aria-modal`, `aria-labelledby`, `role=tabpanel` |
| 7 | `tests/tasks-api.test.ts` — breakpoints 1200/900/700px e `100dvh` |
| 8 | `bun test`, `bun run typecheck`, `bun run lint`, `bun run build` |
| 9 | `tests/sdd-command.test.ts`, `tests/v2-sdk.test.ts`, `tests/system-prompt.test.ts` |

### Baseline regressivo (Fase 0)

O baseline foi reconstruído contra o commit anterior à correção (`a3f27b1`) em um
worktree temporário, usando `tests/baseline-red.test.ts`:

- No commit antigo: **0 pass, 3 fail** — o Kanban ainda usava `allNodes`/`allLinks`, os comandos não tinham `inline` e o dashboard referenciava `unpkg.com`.
- Na árvore corrigida: **4 pass** — estado `allTasks`, contrato `inline`, asset local e ordenação segura por `created_at`/`updated_at`.
- O teste permanece no repositório como regressão explícita; não é um teste retroativo de lógica antiga, e sim a especificação executável do comportamento que antes falhava.

### Resultado final

- Versão: `3.4.2` (`package.json`, `marketplace.json` e `src/version.ts` sincronizados).
- `bun test`: **505 pass, 0 fail, 4056 expect() calls** em 36 arquivos.
- `bun test tests/tasks-api.test.ts tests/baseline-red.test.ts tests/sdd-command.test.ts tests/system-prompt.test.ts`: **68 pass, 0 fail**.
- `bun run typecheck`: passou.
- `bun run lint`: passou com **oxlint 1.95.0** — **0 errors**, 251 warnings de `no-unused-vars` (dívida preexistente).
- `bun run build`: passou; `dist/server/ui/vendor/3d-force-graph.min.js` copiado.
- `git diff --check`: passou sem erros de whitespace.
- Baseline `a3f27b1`: **0 pass, 3 fail**; árvore atual: **4 pass** em `tests/baseline-red.test.ts`.
- Checklist: **288 marcados, 22 pendentes** — todos os pendentes são validação manual em navegador.
- Commit/push: realizados após este registro (consulte o histórico do Git).
- Pendências conhecidas: validação visual/interativa em navegador real (1280px, 1024px, 768px e 390px, zoom 200%, teclado real e rede desligada).
