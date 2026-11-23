# Plano de implementação — fluxos brownfield na versão 3.3.0

**Status:** concluído  
**Versão alvo:** `3.3.0`  
**Escopo:** `purpose=documentation` (AS-IS) e `purpose=reverse_engineering` (spec agnóstica para reconstrução)  
**Princípio:** preservar o modelo task-first da 3.3.0, sem reintroduzir o gate antigo baseado em Change.

---

## 1. Diagnóstico que este plano resolve

| # | Problema | Impacto |
|---|---|---|
| 1 | `documentation` cai no fallback de `buildGraphFromAnalysis` e cria tasks `Implement ...` sem `files` | Board poluído com cards não executáveis; documentação misturada com implementação |
| 2 | `reverse_engineering` cria tasks-alvo sem `files` e sem marcador de escopo | `approveTask` recusa com erro genérico; o backlog parece quebrado em vez de ser um backlog de destino |
| 3 | `sdd.reverse_engineer` chama `finalizeBaseline` diretamente e não chama `writeTaskDossiers` | Markdown de nós existe, mas `.sdd/tasks/<ID>/` não é gerado no scan |
| 4 | `sdd.findings scan/create_task` cria tasks sem regenerar dossiês | Tarefas de remediação ficam sem pacote de rastreabilidade |
| 5 | A chain `sdd.workflow_reverse_engineer` tenta inferir o propósito por regex no output de `sdd.discover` | O output contém as duas opções; sem `purpose` explícito, a escolha pode ser invertida |
| 6 | README, system prompt e `change-bridge.ts` ainda dizem que Change é a autorização de escrita | Contrato contradiz o gate real da 3.3.0: task aprovada é a autorização na delivery |

---

## 2. Decisões de contrato

1. **Documentação é somente leitura da realidade.** O modo `documentation` não cria backlog sintético de implementação. Só cria tasks de remediação para findings.
2. **Backlog reverso é backlog de destino.** Tasks de `reverse_engineering` recebem `metadata.purpose=reverse_engineering` e `metadata.execution_scope=target`. Elas descrevem o que construir no novo sistema; não são aprováveis no projeto de origem enquanto não tiverem arquivos-alvo declarados.
3. **Task aprovada continua sendo o gate de escrita.** Change é registro de auditoria/evolução, não autorização de escrita na delivery.
4. **Todo scan que cria task gera dossiê.** O scan reverso, o scan de findings e a criação avulsa de task de finding chamam `writeTaskDossiers`/`writeTaskDossier`.
5. **Propósito nunca é inferido.** A chain usa apenas `purpose` fornecido explicitamente; sem ele, o passo falha com mensagem clara.
6. **Findings de documentação podem ser resolvidos por task aprovada ou Change.** O texto do produto deve refletir a realidade do código.

---

## 3. Fases de implementação

### Fase 0 — Contratos e tipos

- [x] Adicionar `purpose` e `execution_scope` ao contrato de `ExtractedTask`.
- [x] Adicionar `purpose` opcional ao `BriefingDeepAnalysis`.
- [x] Adicionar `purpose` e `execution_scope` ao `CreateTaskInput`.
- [x] Persistir esses campos em `task.metadata` no `createTask`.

### Fase 1 — Separar documentation de reverse engineering

- [x] Fazer `buildGraphFromAnalysis` não criar fallback de implementação quando `analysis.purpose === "documentation"`.
- [x] Manter o fallback para greenfield e para briefings sem propósito explícito.
- [x] Marcar as tasks reversas com `purpose=reverse_engineering` e `execution_scope=target`.
- [x] Marcar as tasks de findings reversos com `execution_scope=target`.
- [x] Marcar as tasks de findings de documentação com `execution_scope=source`.

### Fase 2 — Aprovação e clareza do backlog-alvo

- [x] Fazer `approveTask` explicar que task-alvo sem arquivos pertence ao backlog de reconstrução.
- [x] Permitir aprovação de task-alvo somente depois que arquivos de destino forem declarados.
- [x] Manter a regra existente: qualquer task sem `files` não pode ser aprovada.

### Fase 3 — Dossiês no scan

- [x] Gerar dossiês ao final de `sdd.reverse_engineer`, depois de findings e status de documentação.
- [x] Gerar dossiês em `sdd.findings(action="scan")`.
- [x] Gerar dossiê em `sdd.findings(action="create_task")`.
- [x] Regenerar o dossiê da task ao resolver finding com `task_id`.
- [x] Informar a quantidade de dossiês no output do scan.

### Fase 4 — Chain com propósito explícito

- [x] Remover a inferência por regex do output de `sdd.discover`.
- [x] Usar somente `purpose` passado explicitamente para a chain.
- [x] Validar `purpose` em `sdd.reverse_engineer` e falhar com mensagem acionável.
- [x] Atualizar a descrição do parâmetro para deixar claro que ele é obrigatório no momento da chamada.

### Fase 5 — Alinhar documentação e prompts ao gate de task

- [x] Atualizar `change-bridge.ts` para dizer que Change é auditoria/evolução e task aprovada é a autorização.
- [x] Atualizar o prompt de implementação para exigir task aprovada.
- [x] Atualizar README sobre findings, backlog reverso e dossiês.
- [x] Atualizar o system prompt sobre resolução de findings e task-alvo.

### Fase 6 — Testes de regressão

- [x] Documentação com entidades/endpoints não cria tasks `Implement ...`.
- [x] Documentação cria tasks de remediação e dossiês.
- [x] Reverse engineering marca tasks-alvo e não permite aprová-las sem arquivos.
- [x] Reverse engineering gera dossiês no scan.
- [x] Chain sem `purpose` não escolhe `reverse_engineering` por engano.
- [x] Testes focados e typecheck passam.

---

## 4. Arquivos previstos

| Arquivo | Mudança |
|---|---|
| `src/sdd/discovery/briefing-analyzer.ts` | Tipos de propósito/escopo no backlog |
| `src/sdd/brownfield/reverse-engineer.ts` | Análise reversa marca propósito e escopo-alvo |
| `src/sdd/discovery/graph-builder.ts` | Sem fallback de implementação em documentation; metadata nas tasks |
| `src/sdd/tasks/board.ts` | `CreateTaskInput`, metadata e erro específico para task-alvo |
| `src/sdd/brownfield/findings.ts` | Tasks de findings com propósito/escopo |
| `src/opencode/tools.ts` | Dossiês no scan, findings e validação de propósito |
| `src/opencode/workflows/chains.ts` | Chain sem inferência de propósito |
| `src/sdd/tasks/change-bridge.ts` | Textos alinhados ao gate de task |
| `README.md` | Contrato público dos dois fluxos |
| `src/opencode/system-prompt.ts` | Instruções do agente alinhadas ao gate |
| `tests/reverse-engineer-flow.test.ts` | Regressão do scan reverso e dossiês |
| `tests/brownfield-findings.test.ts` | Regressão de documentação, findings e dossiês |
| `tests/workflows.test.ts` | Regressão da resolução de propósito |

---

## 5. Critérios de aceite

- [x] `purpose=documentation` produz grafo AS-IS, findings abertos e apenas tasks de remediação; nenhuma task `Implement ...` sintética.
- [x] `purpose=reverse_engineering` produz requirements/tasks de destino, todas marcadas como `execution_scope=target`.
- [x] Task-alvo sem arquivos não pode ser aprovada e retorna mensagem explicando o motivo.
- [x] Todo task criado pelo scan possui `.sdd/tasks/<TASK-ID>/README.md` e `traceability.md`.
- [x] `sdd.workflow_reverse_engineer` sem `purpose` falha de forma explícita; não assume reverse engineering.
- [x] Nenhum teste existente do gate de task regride.
- [x] `bun test` focado passa e `bun run typecheck` passa.

---

## 6. Verificação

```bash
bun test tests/reverse-engineer-flow.test.ts tests/brownfield-findings.test.ts tests/workflows.test.ts
bun run typecheck
```

Se qualquer teste falhar, corrigir a causa antes de considerar a fase concluída.

---

## 7. Resultado da execução

- `bun run typecheck` — **exit 0**.
- `bun test` — **493 pass, 0 fail, 3961 expect() calls**, 34 arquivos.
- `git diff --check` — **exit 0** (sem erros de whitespace).
- Nenhum commit foi criado; as mudanças ficaram no working tree para revisão.

### Arquivos alterados

- `src/sdd/discovery/briefing-analyzer.ts`
- `src/sdd/brownfield/reverse-engineer.ts`
- `src/sdd/discovery/graph-builder.ts`
- `src/sdd/tasks/board.ts`
- `src/sdd/brownfield/findings.ts`
- `src/opencode/tools.ts`
- `src/opencode/workflows/chains.ts`
- `src/sdd/tasks/change-bridge.ts`
- `src/server/tasks-api.ts`
- `src/opencode/command.ts`
- `src/opencode/system-prompt.ts`
- `README.md`
- `tests/reverse-engineer-flow.test.ts`
- `tests/brownfield-findings.test.ts`
- `tests/workflows.test.ts`

### Contratos finais

- `documentation`: sem fallback de tasks `Implement ...`; findings geram tasks de remediação com escopo de origem e dossiê.
- `reverse_engineering`: tasks de destino marcadas com `execution_scope=target`; sem arquivos elas não são aprováveis no projeto de origem; dossiês são gerados no scan.
- `sdd.workflow_reverse_engineer`: não infere propósito; sem `purpose` explícito retorna erro acionável.
- `sdd.findings`: resolução por task aprovada ou Change, com evidência.
- O gate de escrita continua sendo **task aprovada**; Change é auditoria/evolução.

### Atualizações posteriores

- Filtro **Scope** no Kanban (`All`, `Target only`, `Source only`), persistido junto dos demais filtros.
- Exportação do backlog-alvo para um projeto novo, com `export_target`, `dry_run` e o comando determinístico `/sdd export`.
- Resolução de findings de documentação agora exige **task APPROVED** quando usa `task_id`; `change_id` e `target_node_ids` precisam apontar para nós existentes (Change; requirement/decision/constraint).
- Testes de regressão cobrem task não aprovada, Change inexistente e nó-alvo inexistente.
- Verificação final: `bun run typecheck` exit 0, `bun test` 493 pass / 0 fail, `git diff --check` exit 0.
