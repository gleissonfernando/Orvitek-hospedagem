# Bot Orvitek Hospedagem

Bot Discord da Orvitek Hospedagem com `/hospedagem` para cadastro e `/gerenciador` para abrir ferramentas de gerenciamento.

O fluxo atual pede `Client ID`, `ID do servidor`, `Chave de acesso Orvitek` e `Token do bot` em um modal privado do Discord. O ID de Discord do dono e detectado automaticamente por quem clicou em **Cadastrar bot**.
Antes de abrir o modal, o bot consulta os cadastros/liberacoes do Discord do usuario na API. Se existir bot pago/liberado, o usuario escolhe qual quer cadastrar e o formulario abre preenchido com Client ID, servidor e chave de acesso.

## Como usar

1. Instale as dependencias:

```bash
npm install
```

2. Copie `.env.example` para `.env` e preencha:

```bash
PANEL_BOT_TOKEN=...
PANEL_CLIENT_ID=...
PANEL_ADMIN_IDS=seu_discord_id
GUILD_ID=...
TEST_OWNER_ID=...
TEST_BOT_CLIENT_ID=...
TEST_BOT_TOKEN=...
```

`PANEL_CLIENT_ID` pode ficar vazio quando voce usa `npm start`, porque o bot usa o proprio ID apos conectar. Para `npm run register` separado, preencha `PANEL_CLIENT_ID`.

Para varios usuarios, use o formato numerado:

```env
TEST_BOT_1_SERVER_ID=111111111111111111
TEST_BOT_1_OWNER_ID=222222222222222222
TEST_BOT_1_CLIENT_ID=333333333333333333
TEST_BOT_1_TOKEN=TOKEN_1

TEST_BOT_2_SERVER_ID=444444444444444444
TEST_BOT_2_OWNER_ID=555555555555555555
TEST_BOT_2_CLIENT_ID=666666666666666666
TEST_BOT_2_TOKEN=TOKEN_2
```

3. Inicie:

```bash
npm start
```

Esse comando inicia a API e o bot do Discord juntos. Se quiser iniciar separado, use `npm run api:dev` para a API e `npm run bot:start` para o bot.

Para registrar apenas os comandos sem iniciar o bot:

```bash
npm run register
```

4. No Discord, use `/hospedagem` e escolha:

- **Cadastrar bot**

5. Em **Cadastrar bot**, informe:

- Application ID / Client ID
- ID do servidor do cliente
- Chave de acesso Orvitek
- Token do bot

Depois informe o codigo de ativacao de 4 digitos, confirme em **Confirmar cadastro** ou volte em **Corrigir** para ajustar os dados. Na confirmacao, o bot envia os dados para a API e tenta ativar o bot.

## Onde os cadastros ficam

Os cadastros de ID ficam em `data/fivem-users.json`. Esse arquivo fica fora do Git pelo `.gitignore`.

O token nunca e salvo nesse arquivo. Na API ele fica criptografado no MongoDB.

## Varios usuarios

Cada usuario deve ter uma entrada propria no `.env`, com `SERVER_ID`, `OWNER_ID`, `CLIENT_ID` e `TOKEN`.

Exemplo com 2 usuarios:

```env
TEST_BOT_1_SERVER_ID=111111111111111111
TEST_BOT_1_OWNER_ID=222222222222222222
TEST_BOT_1_CLIENT_ID=333333333333333333
TEST_BOT_1_TOKEN=TOKEN_1

TEST_BOT_2_SERVER_ID=444444444444444444
TEST_BOT_2_OWNER_ID=555555555555555555
TEST_BOT_2_CLIENT_ID=666666666666666666
TEST_BOT_2_TOKEN=TOKEN_2
```

Quando alguem clicar em **Verificar e ligar**, o sistema procura uma entrada com o mesmo `serverId`, `ownerId` e `clientId` cadastrados por aquele usuario no painel.

## Permissoes

Convide o bot do painel com `applications.commands` e `bot`.

O bot do cliente tambem precisa estar convidado no servidor onde voce quer que ele funcione.

Para o apagador de tokens no chat funcionar, ative o intent **Message Content Intent** no Discord Developer Portal e de permissao **Manage Messages** para o bot do painel no servidor.

## API segura para tokens

Tambem existe uma API TypeScript/Express para conectar bots de usuarios sem pedir token pelo Discord.

Variaveis necessarias:

```env
API_PORT=3000
API_PUBLIC_URL=https://sua-api-hospedagem.exemplo
HOSTING_BOT_API_URL=https://sua-api-hospedagem.exemplo
MONGODB_URI=
MONGODB_DB_NAME=orvitek
MONGODB_HOSTING_EVENTS_COLLECTION=hosting_shutdown_events
MONGODB_HOSTING_PERMISSIONS_COLLECTION=hosting_registration_permissions
MONGODB_MIN_POOL_SIZE=5
MONGODB_MAX_POOL_SIZE=100
BOT_TOKEN_ENCRYPTION_KEY=chave_base64_de_32_bytes
ORVITEK_API_KEY=chave_secreta_compartilhada_com_o_bot_orvitek
ORVITEK_HOSTING_BOT_URL=https://sua-api-hospedagem.exemplo/api/orvitek/desligar
ORVITEK_HOSTING_BOT_TOKEN=token_para_post_http_da_orvitek
ORVITEK_HOSTING_BOT_DEBUG=true
ORVITEK_MAIN_BOT_NOTIFY_URL=https://bot-vendas-exemplo.invalid/hosting/bot-registered
ORVITEK_MAIN_BOT_NOTIFY_TOKEN=token_para_notificar_o_bot_principal
CORS_ORIGIN=https://seu-painel-exemplo.invalid
```

Em producao, `API_PUBLIC_URL` e `HOSTING_BOT_API_URL` nao podem ficar como `localhost`. Use a URL HTTPS publica da hospedagem e configure essa mesma URL no bot Orvitek Vendas para ele chamar `/api/hosting-plans/sync-client`, `/api/orvitek/desligar`, `/api/orvitek/religar` e `/api/orvitek/fivem-fac-token`.

Para gerar `BOT_TOKEN_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Rodar em desenvolvimento:

```bash
npm run api:dev
```

Build:

```bash
npm run build
npm run api:start
```

Rotas:

```http
POST /api/user-bots/connect
POST /api/user-bots/update-token
DELETE /api/user-bots/:clientId/token
GET /api/user-bots
```

## Planos de hospedagem

O cadastro pelo painel so e liberado quando o bot principal da Orvitek ja sincronizou o cliente com pagamento ativo. A API salva `planExpiresAt`, `planStatus`, `lastPaymentAt`, `lastPaymentAmountCents` e `hostingAccessGranted`.

O bot Orvitek deve chamar as rotas abaixo com o header:

```http
x-orvitek-api-key: SUA_ORVITEK_API_KEY
```

Rotas para o bot Orvitek:

```http
GET /api/hosting-plans
GET /api/hosting-plans/overdue
POST /api/hosting-plans/expire-overdue
POST /api/hosting-plans/sync-client
POST /api/hosting-plans/:clientId/renew
POST /api/hosting-plans/:clientId/suspend
```

Para o bot Orvitek passar todas as informacoes do cliente para a hospedagem, use:

```http
POST /api/hosting-plans/sync-client
```

Exemplo:

```json
{
  "userId": "ID_DO_CLIENTE_NO_DISCORD",
  "guildId": "ID_DO_SERVIDOR",
  "targetUserId": "ID_DO_CLIENTE_NO_DISCORD",
  "clientId": "CLIENT_ID_DO_BOT_DO_CLIENTE",
  "hostingAccessGranted": true,
  "botToken": "TOKEN_REAL_DO_BOT_DO_CLIENTE",
  "planStatus": "active",
  "planStartedAt": "2026-05-23T00:00:00.000Z",
  "planExpiresAt": "2026-06-22T00:00:00.000Z",
  "lastPaymentAmountCents": 1200,
  "lastPaymentAt": "2026-05-23T00:00:00.000Z"
}
```

O bot Orvitek pode chamar essa rota sem `botToken` para liberar o acesso antes do usuario cadastrar pelo painel. Para liberar, envie plano ativo, pagamento (`lastPaymentAt` e `lastPaymentAmountCents`) e `hostingAccessGranted: true` ou uma `hosting.accessKey`. Sem essa liberacao previa, `POST /api/user-bots/connect` retorna 403. Se `planExpiresAt` estiver vencido, a hospedagem salva o cliente e desliga o bot especifico. Se estiver ativo e ja existir token, a hospedagem reinicia/liga o bot do cliente.

Para renovar por mais 30 dias:

```json
{
  "days": 30,
  "amountCents": 1200
}
```

`GET /api/hosting-plans/overdue` retorna os clientes atrasados para o bot Orvitek avisar no Discord. `POST /api/hosting-plans/expire-overdue` desliga automaticamente apenas os bots vencidos. A API tambem faz essa verificacao de hora em hora e nao religa bot com plano vencido.

## Desligamento enviado pelo bot principal Orvitek

A prioridade para desligamento e o MongoDB. Configure este bot no mesmo banco usado pelo bot principal:

```env
MONGODB_URI=mongodb://...
MONGODB_DB_NAME=orvitek
MONGODB_HOSTING_EVENTS_COLLECTION=hosting_shutdown_events
MONGODB_HOSTING_PERMISSIONS_COLLECTION=hosting_registration_permissions
```

A cada 5 segundos, a API busca documentos pendentes em `hosting_shutdown_events`. Para acoes imediatas, prefira chamar `POST /api/orvitek/desligar` ou `POST /api/orvitek/religar`.

```json
{
  "status": "pending",
  "payload": {
    "hosting": {
      "accessKey": "chave_da_hospedagem",
      "status": "vencido",
      "paymentStatus": "overdue"
    },
    "action": {
      "type": "shutdown_client_hosting"
    }
  }
}
```

Quando pega um evento, a API marca como `processing`, usa `payload.hosting.accessKey` ou `clientId` para localizar a hospedagem do cliente, desliga o bot correspondente e atualiza o documento para `processed` ou `failed`. O documento nao e apagado.
Se `payload.action.type` for `restore_client_hosting`, o mesmo worker marca o plano como ativo, libera `hostingAccessGranted` e tenta religar o bot hospedado.

Estados gravados no evento:

```json
{
  "status": "processing",
  "processingStartedAt": "2026-05-23T00:00:00.000Z"
}
```

```json
{
  "status": "processed",
  "processedAt": "2026-05-23T00:00:00.000Z",
  "processingError": null
}
```

```json
{
  "status": "failed",
  "failedAt": "2026-05-23T00:00:00.000Z",
  "processingError": "motivo do erro"
}
```

Para que o `accessKey` possa localizar a hospedagem, salve `hostingAccessKey` ou `hosting.accessKey` ao sincronizar o cliente:

```json
{
  "userId": "ID_DO_CLIENTE_NO_DISCORD",
  "guildId": "ID_DO_SERVIDOR",
  "targetUserId": "ID_DO_CLIENTE_NO_DISCORD",
  "clientId": "CLIENT_ID_DO_BOT_DO_CLIENTE",
  "hosting": {
    "accessKey": "chave_da_hospedagem",
    "projectName": "nome_do_projeto"
  },
  "botToken": "TOKEN_REAL_DO_BOT_DO_CLIENTE",
  "planExpiresAt": "2026-06-22T00:00:00.000Z"
}
```

Opcionalmente, o bot principal pode chamar HTTP:

```http
POST /api/orvitek/desligar
Authorization: Bearer ORVITEK_HOSTING_BOT_TOKEN
```

O body deve ser o mesmo `payload` salvo no evento MongoDB. Exemplo esperado pelo Orvitek Vendas:

```json
{
  "event": "hosting.payment_overdue.shutdown",
  "eventId": "guildId:userId:vencimento",
  "sentAt": "2026-05-23T00:00:00.000Z",
  "guild": {
    "id": "ID_DO_SERVIDOR",
    "name": "Nome do servidor"
  },
  "client": {
    "userId": "ID_DO_USUARIO",
    "userTag": "usuario#0000",
    "plan": "premium",
    "status": "active"
  },
  "hosting": {
    "projectName": "Nome do bot/projeto",
    "accessKey": "chave-de-acesso",
    "status": "current",
    "paymentStatus": "paid",
    "dueAt": "2026-05-23T00:00:00.000Z",
    "graceUntil": "2026-06-07T00:00:00.000Z",
    "cycle": "2026-05",
    "projectChannelId": "ID_DO_CANAL",
    "paymentTicketChannelId": "ID_DO_TICKET"
  },
  "action": {
    "type": "shutdown_client_hosting",
    "reason": "Pagamento de hospedagem em atraso.",
    "requestedBy": "ID_DE_QUEM_SOLICITOU"
  }
}
```

Em sucesso:

Tambem aceita payload direto com `clientId`, sem `accessKey`:

```json
{
  "clientId": "CLIENT_ID_DO_BOT_DO_CLIENTE",
  "hosting": {
    "status": "vencido",
    "paymentStatus": "overdue"
  }
}
```

Quando recebe esse aviso, a API desliga o bot na hora, marca `planStatus` como `overdue`, define `planExpiresAt` para o momento atual e remove a liberacao `hostingAccessGranted`.

```json
{
  "ok": true,
  "message": "Bot desligado com sucesso",
  "eventId": "guildId:userId:vencimento",
  "accessKey": "chave-de-acesso"
}
```

Se a `accessKey` nao localizar bot hospedado:

```json
{
  "ok": false,
  "message": "Bot não encontrado para essa accessKey",
  "eventId": "guildId:userId:vencimento",
  "accessKey": "chave-de-acesso"
}
```

Em erro:

```json
{
  "ok": false,
  "message": "Erro ao desligar bot",
  "error": "mensagem do erro"
}
```

Quando `ORVITEK_HOSTING_BOT_DEBUG=true`, a rota mostra no console quando recebeu o POST do Orvitek Vendas, validou token, consultou `accessKey`, desligou o bot e enviou a resposta.

Para religar apos pagamento confirmado, envie o mesmo formato com:

```http
POST /api/orvitek/religar
Authorization: Bearer ORVITEK_HOSTING_BOT_TOKEN
Content-Type: application/json
```

Campos esperados:

```json
{
  "event": "hosting.payment_confirmed.restore",
  "eventId": "guildId:userId:pagamento",
  "sentAt": "2026-05-23T00:00:00.000Z",
  "hosting": {
    "accessKey": "chave-de-acesso",
    "dueAt": "2026-06-22T00:00:00.000Z"
  },
  "action": {
    "type": "restore_client_hosting"
  }
}
```

Em sucesso, a API marca `planStatus` como `active`, libera `hostingAccessGranted`, atualiza `lastPaymentAt` e tenta iniciar o bot do cliente quando houver token salvo.

## Permissao de cadastro por pagamento

Antes de ativar/hospedar um bot, a API consulta a colecao MongoDB `hosting_registration_permissions`.

Para liberar uma chave, o Orvitek Vendas deve gravar:

```json
{
  "accessKey": "chave-informada-pelo-cliente",
  "allowed": true,
  "status": "paid"
}
```

Se o documento nao existir, `allowed` for `false`, ou `status` nao for `"paid"`, a ativacao e bloqueada com:

```text
Pagamento não confirmado ou chave não liberada pela Orvitek.
```

## Avisar o bot principal quando cadastrar

Quando um bot de cliente for cadastrado com sucesso, esta API pode avisar o bot principal da Orvitek por HTTP.

Configure neste bot de hospedagem:

```env
ORVITEK_MAIN_BOT_NOTIFY_URL=https://bot-principal-exemplo.invalid/hosting/bot-registered
ORVITEK_MAIN_BOT_NOTIFY_TOKEN=token_compartilhado_com_o_bot_principal
```

O bot principal deve aceitar:

```http
POST /hosting/bot-registered
Authorization: Bearer ORVITEK_MAIN_BOT_NOTIFY_TOKEN
Content-Type: application/json
```

Payload enviado:

```json
{
  "source": "orvitek-hosting-bot",
  "event": "hosting.bot_registered",
  "occurredAt": "2026-05-23T00:00:00.000Z",
  "bot": {
    "userId": "ID_DO_DONO",
    "guildId": "ID_DO_SERVIDOR",
    "targetUserId": "ID_DO_CLIENTE",
    "clientId": "CLIENT_ID_DO_BOT",
    "botUsername": "nome_do_bot",
    "botId": "ID_DO_BOT",
    "status": "online",
    "hostingAccessKey": "chave_da_hospedagem",
    "projectName": "nome_do_projeto",
    "planStatus": "active",
    "planExpiresAt": "2026-06-22T00:00:00.000Z"
  }
}
```

Se `ORVITEK_MAIN_BOT_NOTIFY_URL` estiver vazio, o cadastro funciona sem tentar avisar o bot principal.

Para criar o codigo de ativacao de 4 digitos apos pagamento confirmado, o bot principal pode chamar:

```http
POST /api/orvitek/fivem-fac-token
Authorization: Bearer ORVITEK_HOSTING_BOT_TOKEN
Content-Type: application/json
```

Payload:

```json
{
  "guildId": "ID_DO_SERVIDOR",
  "token": "1234",
  "userId": "DISCORD_ID_DO_USUARIO",
  "createdBy": "orvitek-main-bot"
}
```

A rota antiga `POST /api/orvitek/activation-code` continua funcionando como compatibilidade. Se o mesmo `guildId` e codigo ja estiverem associados a outro cliente, ou o codigo ja tiver sido usado, a API responde `409`.

`POST /api/user-bots/connect` recebe:

```json
{
  "guildId": "ID_DO_SERVIDOR",
  "targetUserId": "DISCORD_ID_DO_USUARIO",
  "clientId": "CLIENT_ID_DO_BOT",
  "hostingAccessKey": "CHAVE_LIBERADA_APOS_PAGAMENTO",
  "activationCode": "1234",
  "botToken": "TOKEN_REAL_DO_BOT"
}
```

`guildId` e o ID do servidor onde o bot do cliente vai operar. No modal do `/hospedagem`, esse campo aparece como **ID do servidor** e pode ser trocado antes de confirmar o cadastro.

Quando o usuario clica em **Cadastrar bot**, o bot do painel consulta `GET /api/user-bots` usando o Discord ID dele em `x-user-id`. Assim ele ve os bots ja liberados para o proprio cadastro antes de escolher qual token enviar.

Essa rota nao cria mais plano automaticamente. Antes dela, o bot principal precisa chamar `POST /api/hosting-plans/sync-client` para registrar que o usuario pagou e que o acesso foi liberado.

Todas as rotas usam `x-user-id` como usuario logado nesta base de exemplo. Em producao, troque isso por sessao ou JWT do seu painel.

O token e recebido apenas pelo backend, validado em `/users/@me`, criptografado com AES-256-GCM e salvo localmente em `data/api-user-bots.json`. A API nunca retorna o token, e a tela simples em `/` usa campo `password` e mostra apenas `************` depois de salvo.

MongoDB e obrigatorio em producao. Se `MONGODB_URI` estiver vazio em desenvolvimento, a API usa armazenamento local em JSON apenas para testes. Em producao (`NODE_ENV=production`), a API nao inicia sem MongoDB para evitar perda de dados e problemas de concorrencia.

Para alto volume, use MongoDB com replica set/cluster gerenciado, configure `MONGODB_MIN_POOL_SIZE` e `MONGODB_MAX_POOL_SIZE`, e rode a API com um gerenciador de processos como PM2, Docker Swarm ou Kubernetes. Um unico processo Node nao deve tentar manter dezenas de milhares de bots Discord conectados ao mesmo tempo; distribua a carga em varios workers/maquinas e monitore limites de gateway/sessoes do Discord.

Quando o bot do usuario fica online, ele passa a apagar novas mensagens enviadas por `targetUserId` no servidor `guildId`. Para isso, o bot conectado precisa estar no servidor e possuir a permissao **Manage Messages** no canal.

Para testar sem token real, use somente em desenvolvimento:

```env
ENABLE_DEV_MOCK_BOTS=true
NODE_ENV=development
```

Depois clique em **Cadastrar mock** na tela. Isso cadastra um bot ficticio offline com token falso criptografado, sem passar pelo Discord e sem tentar iniciar bot real.

`FakeToken` serve apenas para desenvolvimento/mock. Para ativar um bot real, a API precisa receber o token real do bot, porque o Discord valida o token e a conexao do gateway.

## Fluxo pelo Discord

O `/hospedagem` abre o painel de cadastro:

- **Cadastrar bot**: pede `Client ID`, `ID do servidor`, `Chave de acesso Orvitek` e `Token do bot`, depois pede o codigo de ativacao de 4 digitos, mostra uma tela de confirmacao com **Confirmar cadastro** e **Corrigir**, e so envia para a API depois da confirmacao.

## Painel gerenciador FiveM

Usuarios podem usar:

```text
/gerenciador
```

`/gerenciador` abre o painel de ferramentas. No fluxo atual, ele mostra **fac FiveM**.

Se o usuario ja tiver acesso liberado por token naquele servidor, o comando abre direto o painel **fac FiveM**. Caso contrario, ele informa o codigo de 4 digitos gerado quando comprou e ativou o bot no painel de hospedagem.

Depois que o codigo e aceito, o painel mostra **Ativar**. Ao clicar, o usuario escolhe o canal de texto onde o **Painel fac** deve aparecer. O bot salva os dados do Discord do usuario, o servidor, o canal escolhido e a mensagem enviada, mantendo o painel fixo naquele canal.

No **Painel fac**, o usuario seleciona qual ferramenta quer usar. A ferramenta **Boas vindas** permite:

- escolher o canal de entrada;
- escolher o canal de saida;
- configurar um banner de boas vindas enviando uma imagem como anexo no Discord;
- enviar boas vindas na DM quando alguem entrar no servidor;
- avisar no canal de entrada quando alguem entrar;
- avisar no canal de saida quando alguem sair.

O **Painel fac** tambem tem a ferramenta **Hierarquia**. Ela comeca com os niveis:

- Lider;
- Gerente;
- Gerente de Acao.

O usuario pode adicionar outros niveis, e cada nivel precisa ter um cargo selecionado. O sistema publica um painel de hierarquia em um canal de texto escolhido e lista automaticamente os membros que possuem cada cargo. Se a pessoa tiver mais de um cargo configurado, ela aparece no primeiro nivel correspondente da ordem da hierarquia. Quando alguem recebe ou perde um cargo configurado, o painel e atualizado para mostrar a hierarquia correta daquele servidor.

Para detectar entrada/saida de membros e atualizar a hierarquia automaticamente por mudanca de cargo, ative **Server Members Intent** no Discord Developer Portal do bot do painel e configure:

```env
ENABLE_MEMBER_EVENTS=true
```

Se esse intent nao estiver ativo no Developer Portal, deixe `ENABLE_MEMBER_EVENTS=false` para o bot iniciar sem erro.

Cada servidor Discord tem seus proprios tokens, acessos e configuracoes.

## Ativacao no bot hospedado

Quando o bot do cliente estiver hospedado e online, ele registra `/ativar` no servidor dele enquanto o Painel fac ainda nao foi liberado.

O usuario que hospedou o bot usa `/ativar`, informa o codigo de 4 digitos recebido apos o pagamento no primeiro bot, e a hospedagem valida esse codigo no servidor atual. Se o codigo estiver disponivel, ele e marcado como usado, o acesso ao Painel fac e liberado para aquele usuario naquele servidor, `/ativar` e removido e `/painel-fac` e registrado.

O comando `/painel-fac` fica visivel no bot hospedado, mas so o usuario que hospedou aquele bot consegue usar.

No cadastro pelo `/hospedagem`, o codigo de ativacao de 4 digitos e obrigatorio. A API consome esse codigo durante `POST /api/user-bots/connect`, antes de ligar o bot hospedado. Assim o bot do cliente ja sobe com o acesso inicial liberado.

O ID do servidor pode ser informado no modal de cadastro. O backend valida, criptografa e liga o bot quando recebe a confirmacao.

Em producao, o campo `Token do bot` precisa conter um token real de bot para o Discord aceitar a conexao. Tokens falsos servem apenas para o fluxo mock de desenvolvimento e nao ativam um bot real.

Em producao, `API_PUBLIC_URL` deve ser uma URL HTTPS publica, por exemplo:

```env
API_PUBLIC_URL=https://sua-api-hospedagem.exemplo
```
