# Autenticação e acessos web

## Fluxo local

1. O frontend envia `identifier` e `password` para `POST /api/auth/login`.
2. O backend procura primeiro o `username` normalizado e mantém compatibilidade com e-mail.
3. A sessão aleatória é persistida somente como SHA-256; o token bruto é devolvido uma única vez.
4. Na inicialização, o frontend restaura o token por `GET /api/auth/me`. Um `401` encerra a sessão local e o realtime; um `403` preserva a sessão.
5. Contas com `must_change_password=true` ficam limitadas a `/api/auth/me`, logout e troca de senha. Após a troca, todas as sessões antigas são revogadas e uma nova sessão é emitida.

## Fluxo SSO opcional

`POST /api/auth/sso` aceita somente JWT HS256 com `iss`, `aud`, `iat`, `exp` e `jti`. O TTL máximo é configurável e cada `jti` só pode ser consumido uma vez. O SSO autentica a identidade, mas não promove nem rebaixa o perfil local; novas identidades SSO entram como `COLLABORATOR`.

Quando o token de sessão é entregue ao frontend por `postMessage`, a mensagem só é aceita do `window.parent` e de uma origem presente em `VITE_SSO_ALLOWED_ORIGINS`.

Variáveis:

- `SSO_SHARED_SECRET`
- `SSO_EXPECTED_ISSUER`
- `SSO_EXPECTED_AUDIENCE`
- `SSO_MAX_TOKEN_TTL_SECONDS` (padrão: 300)
- `VITE_SSO_ALLOWED_ORIGINS` (lista separada por vírgulas)

Login e SSO possuem rate limit conservador e limitado a 10.000 buckets em memória,
configurado por `AUTH_LOGIN_RATE_LIMIT_MAX`, `AUTH_LOGIN_RATE_LIMIT_WINDOW_MS`,
`AUTH_SSO_RATE_LIMIT_MAX` e `AUTH_SSO_RATE_LIMIT_WINDOW_MS`. Sem Redis compartilhado
no projeto, os contadores são locais a cada processo/task ECS; o limite efetivo de um
cluster cresce com a quantidade de réplicas.

O endpoint SSE legado continua registrado e protegido, mas atualmente não há produtor
chamando `emitWhatsAppEvent`. Ele não foi removido por compatibilidade. Sessões SSE são
registradas por token e usuário, revalidadas no keepalive e encerradas nas mesmas ações
de logout/revogação que desconectam Socket.IO.

## Aplicação segura em produção

Pré-requisitos: backup testado, janela de manutenção, artefato do backend já compilado e `DATABASE_URL` apontando explicitamente para o banco correto.

1. Confirme que `schema_migrations` existe e contém o histórico anterior. Se a tabela não existir ou estiver incompleta, interrompa o procedimento e faça o baseline assistido; não execute o runner às cegas sobre um schema legado.
2. Execute a migration explicitamente, antes de iniciar a nova aplicação:

   ```powershell
   Set-Location server
   $env:NODE_ENV = 'production'
   npm run migrate:deploy
   ```

3. Verifique a presença de `074_web_auth_access_control.sql` em `schema_migrations`, os índices de `app_users` e as tabelas `app_user_*`.
4. Obtenha a credencial inicial do gerenciador de segredos, execute o seed compilado e remova a variável do processo:

   ```powershell
   $env:INITIAL_ACCESS_PASSWORD = '<valor obtido do gerenciador de segredos>'
   npm run seed:initial-access:prod
   Remove-Item Env:INITIAL_ACCESS_PASSWORD
   ```

5. Revise a saída do seed: ela informa usuários/vínculos criados ou preservados, nunca a senha.
6. Inicie a aplicação com `npm run start:prod`. Em produção, o startup apenas verifica migrations e recusa iniciar se houver pendências.
7. Valide login, troca obrigatória e estados vazios de gestor/colaboradores antes de atribuir recursos na tela **Acessos**.

O seed é deliberadamente conservador: contas existentes não têm nome, e-mail, perfil,
status, senha ou `must_change_password` alterados. Vínculos existentes também são
preservados, inclusive quando divergentes. Não existe modo de reparação implícito;
qualquer reparo deve ser feito pela tela auditada de **Acessos**. A criação dos sete
usuários e de seus vínculos ocorre em uma única transação e qualquer falha causa rollback.

A migration 074 cria índices normais dentro da transação do runner. Reserve janela de
manutenção: criação de índice e validação de constraint podem manter locks e competir
com escritas, de acordo com o volume atual das tabelas.

A migration é aditiva. Em rollback de aplicação, preserve as colunas e tabelas novas; não apague usuários, sessões ou atribuições. Volte o artefato da aplicação e investigue antes de qualquer reversão destrutiva de banco.
