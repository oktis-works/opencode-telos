# Plano de Implementação — Telos SDD

**Objetivo:** eliminar a criação precoce de `change` nodes, tornar a `task` o único gate de aprovação/implementação e garantir rastreabilidade completa por task em `.md` e `.mmd`, sem travar a documentação inicial.

**Versão alvo:** `3.3.0` (minor: novo ciclo de vida, aprovação por task, dossiês e diagramas).

**Status:** concluído e validado em 2026-11-22.

---

## 1. Diagnóstico que este plano resolve

| Problema atual | Causa raiz | Resultado esperado |
|---|---|---|
| Vários `change` nodes na primeira interação | `sdd.enforce` + bridge task→change criam Change no bootstrap | Bootstrap não cria Change; Change só em evolução |
| Modelo travado na criação das docs | Toda mutação/implementação exige workflow e Change aprovado | Docs e tasks evoluem livremente; task aprovada libera código |
| Aprovação espalhada | `change.status`, `approval_level`, task, acceptance, final acceptance | Aprovação humana única na task |
| `.md` raso e sem detalhes | `buildInitialMarkdown` genérico; conteúdo rico descartado | `.md` com metadados, relações e vínculos reais |
| Sem `.mmd` | Nenhum gerador Mermaid | Fluxo, ER, sequência e arquitetura por task |
| Task sem rastreabilidade completa | Task só tem arquivos/critérios | Dossiê com grafo, `.md`, `.mmd`, arquivos, testes e critérios |

---

## 2. Modelo de ciclo de vida

```
bootstrap  → documentação/descoberta/grafo/tasks. Sem Change. Sem aprovação de Change.
delivery   → baseline fechado; tasks aprovadas liberam implementação direta.
evolution  → modificações posteriores; Change é registro de mudança, aprovação continua na task.
```

Marco persistido em `project.metadata.lifecycle`:

```json
{
  "phase": "bootstrap | delivery | evolution",
  "baseline": { "status": "PENDING | COMPLETE", "completed_at": "...", "version": 1 },
  "updated_at": "..."
}
```

Regras:
- `phase = bootstrap` e `baseline.status != COMPLETE` ⇒ `createChange`, `enforce`, `open_change` recusam.
- `sdd.finalize_baseline` fecha o baseline e move para `delivery`.
- Primeiro Change criado depois do baseline move para `evolution`.
- Grafos legados sem `lifecycle` permanecem compatíveis (inferência conservadora).

---

## 3. Checklist completo

### Fase A — Ciclo de vida e fim do Change precoce

- [x] A1. Criar `src/sdd/lifecycle/project-phase.ts` com leitura/escrita de fase, baseline e guardas.
- [x] A2. Inicializar `lifecycle = bootstrap/PENDING` em `createProject` (YAML e SQLite) e no bootstrap de descoberta.
- [x] A3. Criar tool standalone `sdd.finalize_baseline` (fecha docs, grava marco, gera dossiês, retorna próximo passo).
- [x] A4. Registrar a tool em `tools.ts`, `categories.ts`, `state-gate.ts`, `workflow-tracker.ts` e catálogo.
- [x] A5. Bloquear `createChange` no bootstrap com mensagem acionável.
- [x] A6. Bloquear `sdd.create_change`, `sdd.enforce` e `sdd.full_cycle` no bootstrap (sem criar Change).
- [x] A7. Bloquear `openChangeForTask`/`open_change` no bootstrap.
- [x] A8. Remover a criação automática de Change no `mark_integrated`; integração passa a apenas vincular/gerar dossiê.
- [x] A9. `sdd.generate_code` autoriza por task aprovada (delivery) e mantém Change apenas para evolução/legado.
- [x] A10. Ao criar o primeiro Change pós-baseline, mover `phase` para `evolution`.

### Fase B — Task como gate único

- [x] B1. Adicionar `approval` (`PENDING|APPROVED|REJECTED`, `approved_by`, `approved_at`, `note`) ao metadata da task.
- [x] B2. Criar `approveTask`, `rejectTask`, `taskApproval`, `taskCoversFile`, `findApprovedTaskForFile` em `board.ts`.
- [x] B3. Aprovar task exige `files` declarados e gera dossiê; aprovação move para `in_progress`.
- [x] B4. Alteração de `files`/escopo depois de aprovada invalida a aprovação (volta a `PENDING`).
- [x] B5. Write gate (Write/Edit) aceita task aprovada cobrindo o arquivo.
- [x] B6. Shell gate aceita task aprovada cobrindo o arquivo, mantendo bloqueios de `.sdd/` e escape de path.
- [x] B7. `sdd.integrate_tasks` ganha `approve_task`, `reject_task`, `dossier`; `mark_integrated` não abre Change.
- [x] B8. API do dashboard ganha aprovação/rejeição de task e o card mostra o estado.
- [x] B9. `/sdd tasks approve <ID>` e `/sdd tasks reject <ID>` no comando.
- [x] B10. Change aprovado continua aceito como compatibilidade legada, mas não é mais exigido para tasks de delivery.

### Fase C — Rastreabilidade `.md` + `.mmd`

- [x] C1. Criar `src/sdd/documentation/mermaid.ts` com geradores determinísticos: `flowchart`, `erDiagram`, `sequenceDiagram`, `flowchart` de arquitetura.
- [x] C2. Criar `src/sdd/tasks/dossier.ts` que resolve o subgrafo da task e escreve:
  - `.sdd/tasks/<TASK-ID>/README.md`
  - `.sdd/tasks/<TASK-ID>/traceability.md`
  - `.sdd/tasks/<TASK-ID>/flow.mmd`
  - `.sdd/tasks/<TASK-ID>/data-model.mmd`
  - `.sdd/tasks/<TASK-ID>/sequence.mmd`
  - `.sdd/tasks/<TASK-ID>/architecture.mmd`
  - `.sdd/tasks/index.md`
- [x] C3. Dossiê inclui requisitos, features, entidades, endpoints, regras, fluxos, critérios, testes, arquivos e links para `.md` de cada nó.
- [x] C4. Gerar/atualizar dossiê em criação, atualização, integração e aprovação de task; ação manual `dossier`.
- [x] C5. Enriquecer `buildInitialMarkdown` com metadados, campos, relações e arquivos.
- [x] C6. Corrigir `sdd.generate_node_doc` para gravar o Markdown gerado (hoje descarta).
- [x] C7. Implementar merge real (preservar seções manuais e atualizar seções automáticas).
- [x] C8. Corrigir `generateDocumentation(graph, params.format)` para `{ type }`.
- [x] C9. `sdd.sync_markdown` também sincroniza dossiês das tasks.
- [x] C10. Validar Mermaid gerado (IDs sanitizados, labels escapados, referências existentes).

### Fase D — Prompt, estado e documentação do produto

- [x] D1. Criar instrução de enforcement por fase em `state-gate.ts`.
- [x] D2. Ajustar `system-prompt.ts`: bootstrap sem `enforce`; delivery por task; evolution com Change.
- [x] D3. Resolver a contradição “nunca gere `.md`” vs. docs obrigatórias: `.md`/`.mmd` são artefatos gerados em `.sdd/`.
- [x] D4. Atualizar `sdd-runtime.ts`: não anunciar Change pendente no bootstrap; anunciar tasks aguardando aprovação.
- [x] D5. Atualizar `README.md` com o novo fluxo (bootstrap → delivery → evolution; task gate; dossiê).
- [x] D6. Atualizar `ANALISE_GRAFOS_MARKDOWN.md` ou criar seção de arquitetura apontando para o novo modelo.

### Fase E — Testes e validação

- [x] E1. Testes novos: bootstrap sem Change; baseline; task approval; write gate por task; dossiê `.md`/`.mmd`; Mermaid; create_change bloqueado.
- [x] E2. Atualizar testes existentes afetados (`change-gate`, `tasks-api`, `bootstrap`, `workflows`, `tool-catalog`).
- [x] E3. Rodar `npm run typecheck`.
- [x] E4. Rodar `npm test` (suíte completa).
- [x] E5. Rodar `npm run build`.
- [x] E6. Smoke test em projeto temporário: bootstrap → finalize → approve task → write → dossiê.

### Fase F — Versão e GitHub

- [x] F1. Bump `package.json` para `3.3.0`.
- [x] F2. Rodar `npm run version:sync` e confirmar `src/version.ts`.
- [x] F3. Build final e suíte verde.
- [x] F4. Revisar `git diff` e arquivos não rastreados.
- [x] F5. Commit descritivo.
- [x] F6. Push para `origin` (`main`) e confirmar `git status` limpo.

---

## 4. Critérios de aceite

1. Em projeto novo, `sdd.update_from_answers`/`sdd.build_graph` cria docs e tasks **sem nenhum `change` node**.
2. `sdd.enforce` e `sdd.create_change` no bootstrap retornam bloqueio explicando `sdd.finalize_baseline`, sem criar node.
3. `sdd.finalize_baseline` grava `baseline.status = COMPLETE` e `phase = delivery`.
4. Aprovar uma task com `files` libera Write/Edit e shell para exatamente esses arquivos, sem Change.
5. Task sem aprovação continua bloqueando escrita.
6. Após o baseline, `sdd.enforce` cria Change; a aprovação da task continua sendo o gate humano.
7. Cada task aprovada tem dossiê com `.md`, `.mmd` de fluxo/ER/sequência/arquitetura, grafo e links.
8. `sdd.generate_node_doc` grava conteúdo com metadados e relações, não apenas TODOs.
9. `npm run typecheck`, `npm test` e `npm run build` passam.
10. Versão `3.3.0` publicada no commit e enviada ao GitHub.

---

## 5. Riscos e mitigação

- **Bypass do gate:** task aprovada só libera arquivos declarados; paths normalizados; auditoria mantida.
- **Projetos legados:** sem `lifecycle`, mantém comportamento anterior; `finalize_baseline` migra explicitamente.
- **Tasks antigas sem aprovação:** continuam bloqueadas até aprovação explícita.
- **Mermaid inválido:** geração determinística + sanitização + teste de conteúdo.
- **Regressão de catálogo:** toda tool nova entra em `categories`, `CLASSIFIED_TOOLS` e testes de catálogo.
