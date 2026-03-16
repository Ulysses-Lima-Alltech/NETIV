# Sistema de Classificação de Leads e Funil Comercial

## Visão geral

O sistema classifica leads de forma **contínua** com base nas mensagens da conversa, sem depender de IA externa (OpenAI). A análise é **heurística**, **determinística** e executada em menos de 10 ms.

## Estrutura do funil

Estágios do funil de vendas:

| Estágio | Descrição |
|--------|-----------|
| **COLD** | Lead explorando; perguntas genéricas; curiosidade. |
| **WARM** | Interesse claro; perguntas sobre o serviço; quer entender o funcionamento. |
| **HOT** | Intenção de compra; perguntas sobre preço; pedido de proposta; quer contratar. |

## Como funciona o score

- **lead_score**: valor entre 0 e 1, calculado a partir das últimas 20 mensagens **inbound** da conversa.
- **Regras**:
  - Mensagem contém termos de interesse (preço, valor, orçamento, contratar, fechar, pagar, plano, assinatura, proposta, etc.) → +0,25.
  - Mensagem contém frases fortes (“quero contratar”, “vamos fechar”, “quero pagar”, “manda proposta”) → +0,5.
  - Conversa com mais de 5 mensagens → +0,1.
- O score é limitado ao máximo 1.

## Como o estágio muda

Com base no **lead_score**:

| Score    | Estágio |
|----------|---------|
| 0,0 – 0,4 | COLD  |
| 0,4 – 0,7 | WARM  |
| 0,7 – 1,0 | HOT   |

## Intenção atual (lead_intent_now)

- **HIGH**: última mensagem contém intenção de compra (frases fortes).
- **MEDIUM**: conversa ativa (≥ 2 mensagens e score ≥ 0,25) sem frase forte na última mensagem.
- **LOW**: conversa parada ou neutra.

## Como testar no simulador

1. Acesse **/lead-simulator** no frontend.
2. Cole ou digite mensagens no textarea (uma por linha).
3. Clique em **Analisar Lead**.
4. O resultado exibe: **Lead Score**, **Lead Stage**, **Intent Now** e **Motivo da classificação**.

O simulador chama apenas o endpoint **POST /api/lead/analyze** com `{ "messages": ["msg1", "msg2", ...] }` e **não utiliza OpenAI**.

## Integração com a IA

No motor de conversa, após cada mensagem inbound:

1. A mensagem é salva.
2. É executado `analyzeLead(conversationId)`.
3. O **lead_stage** da conversa é lido.
4. O modelo de IA é escolhido conforme o estágio:
   - **COLD** ou **WARM** → `model_cold_lead`
   - **HOT** → `model_hot_lead`

Assim, respostas para leads quentes podem usar um modelo mais focado em conversão (ex.: `gpt-4o`), e leads frios/quentes em exploração usam o modelo padrão (ex.: `gpt-4`).

## Colunas no banco (conversations)

- `lead_stage` (TEXT, default 'COLD')
- `lead_score` (REAL, default 0)
- `lead_intent_now` (TEXT, default 'LOW')
- `lead_reason` (TEXT, motivo da classificação)
- `lead_last_analyzed_at` (DATETIME, última análise)

## Performance

- A análise é **síncrona** e **determinística**.
- Não há chamadas a APIs externas no `leadAnalyzer`.
- Projetado para executar em **menos de 10 ms**.
