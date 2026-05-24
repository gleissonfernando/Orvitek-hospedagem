# Orvitek Hospedagem

Bot de hospedagem da Orvitek para gerenciar bots de clientes.

## Como usar

1. Instale as dependencias:

```bash
npm install
```

2. Configure as variaveis privadas no ambiente da hospedagem ou em um arquivo `.env` local.

3. Inicie:

```bash
npm start
```

## Comandos

O bot possui painel no Discord para cadastro, gerenciamento e remocao de bots hospedados.

## Configuracao

O arquivo `.env` real nunca deve ser publicado.

Use `.env.example` apenas como modelo publico com valores ficticios. Tokens, chaves, URLs privadas, banco de dados, rotas internas e dados de clientes devem ficar somente na hospedagem.

## Seguranca

Nao publique:

- token de bot;
- chave de API;
- URL privada da API;
- URI de banco de dados;
- IDs reais de clientes, canais ou servidores;
- rotas internas administrativas;
- dados de pagamento ou hospedagem.

Se algum valor real for exposto, troque o token/chave imediatamente no provedor correspondente.
