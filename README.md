# Bot Orvitek Hospedagem

Bot Discord da Orvitek Hospedagem com `/painel` e `/panel` para registrar, ativar e remover bots de clientes pela API.

O fluxo atual pede `Client ID`, `ID de Discord`, `ID do servidor dos comandos` e `FakeToken` em um modal privado do Discord, mostra uma confirmacao e so envia para a API depois que o usuario confirma.
Antes de abrir o modal, o bot consulta os cadastros/liberacoes do Discord do usuario na API. Se existir bot pago/liberado, o usuario escolhe qual quer cadastrar e o formulario abre preenchido com o dono, Client ID e servidor dos comandos.

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

Para registrar apenas os comandos `/painel` e `/panel` sem iniciar o bot:

```bash
npm run register
```

4. No Discord, use `/painel` ou `/panel` e escolha:

- **Register Bot**
- **Delete Bot**: aparece somente para IDs configurados em `PANEL_ADMIN_IDS`

5. Em **Register Bot**, informe:

- Client ID
- ID de Discord
- FakeToken

Depois confirme em **Confirm Registration** ou volte em **Correct** para corrigir os dados. Na confirmacao, o bot envia os dados para a API e tenta ativar o bot.

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
API_PUBLIC_URL=https://sua-api-exemplo.invalid
HOSTING_BOT_API_URL=https://sua-api-exemplo.invalid
MONGODB_URI=
MONGODB_DB_NAME=orvitek
MONGODB_HOSTING_EVENTS_COLLECTION=hosting_shutdown_events
MONGODB_HOSTING_REGISTRATION_PERMISSIONS_COLLECTION=hosting_registration_permissions
MONGODB_MIN_POOL_SIZE=5
MONGODB_MAX_POOL_SIZE=100
BOT_TOKEN_ENCRYPTION_KEY=chave_base64_de_32_bytes
ORVITEK_API_KEY=chave_secreta_compartilhada_com_o_bot_orvitek
ORVITEK_HOSTING_BOT_URL=https://sua-api-exemplo.invalid/caminho-interno
ORVITEK_HOSTING_BOT_TOKEN=token_para_post_http_da_orvitek
ORVITEK_HOSTING_BOT_DEBUG=true
ORVITEK_MAIN_BOT_NOTIFY_URL=
ORVITEK_MAIN_BOT_NOTIFY_TOKEN=token_para_notificar_o_bot_principal
CORS_ORIGIN=https://seu-painel-exemplo.invalid
```

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
POST /api/hosting-plans/sync-hierarchy-commands
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
MONGODB_HOSTING_REGISTRATION_PERMISSIONS_COLLECTION=hosting_registration_permissions
```

A cada 5 segundos, a API busca documentos pendentes em `hosting_shutdown_events`. Para desligamento imediato, prefira chamar `POST /api/orvitek/desligar`.

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
ORVITEK_MAIN_BOT_NOTIFY_URL=https://bot-principal-exemplo.invalid/caminho-interno
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

`POST /api/user-bots/connect` recebe:

```json
{
  "guildId": "ID_DO_SERVIDOR",
  "targetUserId": "DISCORD_ID_DO_USUARIO",
  "clientId": "CLIENT_ID_DO_BOT",
  "botToken": "TOKEN_REAL_DO_BOT"
}
```

`guildId` e o ID do servidor onde o bot do cliente vai registrar e mostrar comandos como `/herarquia` e `/hierarquia`. No modal do `/hospedagem`, esse campo aparece como **ID do servidor dos comandos** e pode ser trocado antes de confirmar o cadastro.

Quando o usuario clica em **Cadastrar bot**, o bot do painel consulta `GET /api/user-bots` usando o Discord ID dele em `x-user-id`. Assim ele ve os bots ja liberados para o proprio cadastro antes de escolher qual token enviar.

Essa rota nao cria mais plano automaticamente. Antes dela, o bot principal precisa chamar `POST /api/hosting-plans/sync-client` para registrar que o usuario pagou e que o acesso foi liberado.

Todas as rotas usam `x-user-id` como usuario logado nesta base de exemplo. Em producao, troque isso por sessao ou JWT do seu painel.

O token e recebido apenas pelo backend, validado em `/users/@me`, criptografado com AES-256-GCM e salvo localmente em `data/api-user-bots.json`. A API nunca retorna o token, e a tela simples em `/` usa campo `password` e mostra apenas `************` depois de salvo.

MongoDB e obrigatorio em producao. Se `MONGODB_URI` estiver vazio em desenvolvimento, a API usa armazenamento local em JSON apenas para testes. Em producao (`NODE_ENV=production`), a API nao inicia sem MongoDB para evitar perda de dados e problemas de concorrencia.

Para alto volume, use MongoDB com replica set/cluster gerenciado, configure `MONGODB_MIN_POOL_SIZE` e `MONGODB_MAX_POOL_SIZE`, e rode a API com um gerenciador de processos como PM2, Docker Swarm ou Kubernetes. Um unico processo Node nao deve tentar manter dezenas de milhares de bots Discord conectados ao mesmo tempo; distribua a carga em varios workers/maquinas e monitore limites de gateway/sessoes do Discord.

Quando o bot do usuario fica online, ele passa a apagar novas mensagens enviadas por `targetUserId` no servidor `guildId`. Para isso, o bot conectado precisa estar no servidor e possuir a permissao **Manage Messages** no canal.

## Sistema de hierarquia dos bots hospedados

Todo bot de cliente que estiver cadastrado e online registra os comandos `/herarquia` e `/hierarquia` no servidor dele.
Ao iniciar a API, a hospedagem tambem sincroniza esses comandos direto pela API do Discord para todos os bots cadastrados com token e plano ativo.

Subcomandos disponiveis:

```text
/herarquia ver
/herarquia nivel nome:<nome> cargo:<cargo>
/herarquia remover-nivel nome:<nome>
/herarquia aplicar usuario:<usuario> nivel:<nome>
/herarquia autocargo acao:adicionar cargo:<cargo>
/herarquia autocargo acao:remover cargo:<cargo>
/herarquia resetar
```

Quem configura ou aplica cargos precisa ter **Gerenciar Cargos**. O bot hospedado tambem precisa ter permissao **Manage Roles** e o cargo do bot precisa ficar acima dos cargos que ele vai aplicar.

Para os cargos automaticos funcionarem quando um membro entra no servidor, ative **Server Members Intent** no Discord Developer Portal do bot do cliente.

Para forcar a sincronizacao dos comandos sem reiniciar:

```http
POST /api/hosting-plans/sync-hierarchy-commands
x-orvitek-api-key: SUA_ORVITEK_API_KEY
```

Para sincronizar apenas um bot:

```json
{
  "clientId": "CLIENT_ID_DO_BOT"
}
```

O bot do cliente precisa ter sido convidado no servidor com o escopo `applications.commands`. Sem esse escopo, o Discord nao mostra comandos de barra mesmo quando a API registra corretamente.

Para testar sem token real, use somente em desenvolvimento:

```env
ENABLE_DEV_MOCK_BOTS=true
NODE_ENV=development
```

Depois clique em **Cadastrar mock** na tela. Isso cadastra um bot ficticio offline com token falso criptografado, sem passar pelo Discord e sem tentar iniciar bot real.

`FakeToken` serve apenas para desenvolvimento/mock. Para ativar um bot real, a API precisa receber um token real de bot, porque o Discord valida o token e a conexao do gateway.

## Fluxo pelo painel do Discord

O `/painel` e o `/panel` abrem um painel com dois botoes:

- **Register Bot**: pede `Client ID`, `ID de Discord` e `FakeToken`, mostra uma tela de confirmacao com **Confirm Registration** e **Correct**, e so envia para a API depois da confirmacao.
- **Delete Bot**: aparece somente para administradores configurados em `PANEL_ADMIN_IDS`, pede `Client ID` e `ID de Discord`, mostra uma tela de confirmacao e remove/desliga o bot pela API.

## Painel gerenciador

Administradores configurados em `PANEL_ADMIN_IDS` podem usar:

```text
/painel-gerenciador
/gerenciar
/gerenciar usuario:@usuario
```

`/painel-gerenciador` abre um painel com:

- **Ver cadastrados**: mostra quem cadastrou cada bot, client ID, servidor, status online/offline e situacao do plano.
- **Registrar hierarquia**: sincroniza `/herarquia` e `/hierarquia` em todos os bots cadastrados com token e plano ativo.

`/gerenciar` mostra diretamente a lista de bots cadastrados. Cada bot aparece com o dono (`userId`) porque cada bot hospedado pertence a uma pessoa diferente.

Para o painel gerenciador funcionar, o bot do painel tambem precisa ter `ORVITEK_API_KEY` no `.env`, a mesma chave usada nas rotas `/api/hosting-plans`.

O ID do servidor dos comandos pode ser informado no modal de cadastro. O backend valida, criptografa e liga o bot quando recebe a confirmacao.

Em producao, o campo `FakeToken` precisa conter um token real de bot para o Discord aceitar a conexao. Tokens falsos servem apenas para o fluxo mock de desenvolvimento e nao ativam um bot real.

Em producao, `API_PUBLIC_URL` deve ser uma URL HTTPS publica, por exemplo:

```env
API_PUBLIC_URL=https://sua-api-exemplo.invalid
```
