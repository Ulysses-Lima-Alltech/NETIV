# Resumo executivo - validacao do grafo anaGraph em escala (73 turnos)

**Gerado em:** 2026-08-14T13:14:10.484Z
**Amostra:** 73 turnos reais, 39 conversas distintas, 4 empresas com enterpriseId resolvido (Evora, EcoGarden, ALTIS PIRITUBA, oliva317) + 25 turnos com empresa nao resolvida
**Execucao:** `AWS_PROFILE=netiv-prod ANA_PROVIDER=bedrock npm run anagraph:harness 40` (Bedrock real, somente leitura, modo sombra)

## Numeros

| Metrica | Valor |
|---|---|
| Total de turnos | 73 |
| Silencio puro (sem resposta, sem handoff) | 0 (0.0%) |
| Handoff (automationBlockedByHandoff) | 42 (57.5%) |
| Classificados coerente | 53 |
| Classificados divergente mas defensavel | 20 |
| Classificados problema real | 0 |
| Matches exatos de texto com o legado | 2 |
| Erros de execucao | 0 |

## Leitura rapida

- Silencio puro continua em 0% - nenhum turno terminou sem resposta e sem handoff nesta amostra maior (73 turnos, vs. 24 na validacao anterior).
- Handoffs observados nesta amostra (42 de 73) parecem justificados numa primeira leitura: pedido explicito de corretor, empresas sem base de conhecimento configurada (EcoGarden, oliva317, e conversas com enterpriseId nao resolvido), ou mensagens de sistema/spam sem conteudo real. Nenhum handoff observado pareceu disparado sem relacao com a mensagem do cliente.
- Relatorio B veio vazio - nenhum turno foi classificado como "problema real" nesta revisao. Ver nota de cautela dentro do proprio Relatorio B (amostra nao e exaustiva).
- A maior parte da divergencia de texto (Relatorio A) e estilistica ou de nivel de detalhe, nao de conteudo incorreto - mas isso e avaliacao de quem gerou o relatorio; os itens ficam com campo "Avaliacao" em branco para leitura cega humana.
- Relatorio C (agendamento por texto livre) tem uma ressalva metodologica importante: o harness roda cada turno isolado, sem o checkpointer real (Postgres) que preservaria o estado da conversa entre turnos em producao/modo sombra real - isso pode explicar parte da divergencia nos casos de continuacao de fluxo de agendamento (ex.: cliente responde so o nome proprio).

## Arquivos gerados

1. `anagraph-review-textos-divergentes.md` (Relatorio A) - 73 itens, revisao cega, campo "Avaliacao" em branco pra preencher.
2. `anagraph-review-problemas.md` (Relatorio B) - vazio nesta amostra, com nota explicando.
3. `anagraph-review-agendamento.md` (Relatorio C) - 6 itens, comparacao lado a lado, decisao de produto em aberto.
4. JSON bruto: `anagraph-harness-report-1786712907562-enriched.json` (dados originais + enterpriseName/knowledgeChunkCount anexados para este resumo).

## Recomendacao objetiva

Com uma amostra maior (73 turnos, 4 empresas, incluindo pelo menos duas com base de conhecimento rica - Evora 36 chunks, ALTIS PIRITUBA 39 chunks - e duas sem base configurada - EcoGarden e oliva317, 0 chunks cada), o padrao se mantem: zero silencio puro, handoffs justificados, e nenhum problema real identificado nesta revisao automatizada inicial.

Isso sustenta avancar para a revisao humana final dos Relatorios A e C antes de decidir sobre piloto - nao e recomendacao de ir direto a piloto sem essa leitura humana, e a ressalva metodologica do Relatorio C (limitacao de continuidade de estado do harness) precisa ser esclarecida antes de fechar a avaliacao de fidelidade do fluxo de agendamento.
