# Relatorio B - Casos classificados como problema real

Gerado a partir da mesma amostra de 73 turnos (AWS_PROFILE=netiv-prod ANA_PROVIDER=bedrock).

## Nenhum problema real encontrado

Dos 73 turnos revisados manualmente nesta amostra, nenhum foi classificado como "problema real" (grafo errou o assunto claramente, ficou em silencio sem handoff, ou tomou uma acao - visitScheduling/humanHandoff - sem relacao com a mensagem do cliente).

Isso e um bom sinal para a fase de validacao, mas nao deve ser lido como "zero risco": a amostra cobre 4 empresas e 73 turnos, nao e exaustiva. Casos "divergente mas defensavel" (texto diferente do legado, mas plausivel) estao no Relatorio A para julgamento humano - vale revisao manual desses antes de decidir.

