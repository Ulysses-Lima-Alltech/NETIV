# Relatorio C - Agendamento por texto livre (fidelidade grafo vs. legado)

Amostra: 6 turnos filtrados de 73 turnos totais, onde o eixo e agendamento/visita ou a mensagem do cliente e claramente uma resposta dentro de um fluxo de agendamento em andamento (ex.: nome proprio isolado, resposta a oferta de visita).

Nota de contexto importante: o harness roda cada turno de forma isolada (checkpointer em memoria descartavel, thread_id unico por turno) - ele NAO carrega o commercial_flow_state persistido da conversa real antes de reexecutar o turno. Isso significa que, para turnos de continuacao de um fluxo de agendamento (ex.: "Elias Oliveira" respondendo a "como posso te chamar"), o grafo neste harness nao sabe que uma visita ja estava sendo oferecida/negociada - ele decide o turno "do zero". Em producao real (ou no modo sombra via shadowRunner.ts), o grafo usa um checkpointer real (Postgres) com thread_id estavel por conversa, o que preserva esse contexto entre turnos. Ou seja: parte da divergencia abaixo pode ser limitacao do metodo de comparacao do harness, nao necessariamente do grafo em uso real - mas vale confirmar isso separadamente antes de descartar como "nao e bug".

Nenhum dos 73 turnos da amostra teve o eixo graphPrimaryAxis resolvido como agendamento/visita explicitamente - os itens abaixo foram selecionados pelo conteudo da mensagem/resposta, nao pelo campo de eixo.

Esta comparacao e lado a lado (com a resposta do legado) porque a decisao aqui e de produto: a interpretacao do grafo e aceitavel mesmo sendo diferente, ou precisa de mais um ajuste? Essa decisao nao foi tomada nesta tarefa.

---

## 1 (conversationId 17623)

**Mensagem do cliente:**
> pode ser

**Resposta do motor legado:**
> (vazio)

**Resposta do grafo:**
> Claro! Posso te conectar com um corretor para agendar uma visita no Évora.

**Decisao de produto:** ___ (aceitavel / precisa ajuste)

---

## 2 (conversationId 19603)

**Mensagem do cliente:**
> Elias Oliveira

**Resposta do motor legado:**
> Perfeito. Posso confirmar sua visita para amanhã às 9h?

**Resposta do grafo:**
> Entendi, Elias. Vou encaminhar seu contato para o corretor, que entrará em contato com você para agendar a visita e tirar todas as suas dúvidas.

**Decisao de produto:** ___ (aceitavel / precisa ajuste)

---

## 3 (conversationId 19603)

**Mensagem do cliente:**
> Não

**Resposta do motor legado:**
> Perfeito. Para qual dia você prefere agendar a visita?

**Resposta do grafo:**
> Entendo! Posso encaminhar seu contato para o corretor, que entrará em contato para atendê-lo diretamente.

**Decisao de produto:** ___ (aceitavel / precisa ajuste)

---

## 4 (conversationId 19603)

**Mensagem do cliente:**
> Falar com corretor

**Resposta do motor legado:**
> Perfeito. Para qual dia você prefere agendar a visita?

**Resposta do grafo:**
> Olá! Obrigada pelo seu contato e pelo interesse.
> 
> No momento, seu atendimento será direcionado para um corretor. Em breve, um especialista entrará em contato para passar mais informações e te ajudar da melhor forma.

**Decisao de produto:** ___ (aceitavel / precisa ajuste)

---

## 5 (conversationId 3400)

**Mensagem do cliente:**
> Maria Ivonete Mantovani agradece seu contato. Como posso ajudar?

**Resposta do motor legado:**
> Olá, Maria! Que bom ter você por aqui 😊 O Évora é um loteamento fechado em Atibaia, com lotes a partir de 360 m², bem perto da natureza e a apenas 50 minutos de São Paulo, pela Dom Pedro I. Você já pensou em como gostaria de aproveitar esse espaço para o seu estilo de vida?

**Resposta do grafo:**
> Oi, Maria! Agradeço o retorno 😊 Posso te ajudar a marcar uma visita ao Évora?

**Decisao de produto:** ___ (aceitavel / precisa ajuste)

---

## 6 (conversationId 4941)

**Mensagem do cliente:**
> Nas duas opções 20% m

**Resposta do motor legado:**
> Sim, a entrada padrão é de 20% em qualquer uma das opções. seja no parcelamento sem juros até 48x ou nos planos estendidos até 120x. O restante é dividido conforme o plano que você escolher, e o financiamento direto com a construtora facilita bastante o processo, com menos burocracia. Você já pensou em como gostaria de usar o espaço externo do seu futuro lar. como um jardim, área de lazer ou até um cantinho só para relaxar?

**Resposta do grafo:**
> Fico feliz em ajudar! 😊 Se precisar de mais alguma informação ou quiser agendar uma visita para conhecer o Évora, é só chamar.

**Decisao de produto:** ___ (aceitavel / precisa ajuste)

---

