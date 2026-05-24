# Orvitek Hospedagem

Bot e API de hospedagem da Orvitek para gerenciar bots de clientes.

## Uso

As configuracoes sensiveis ficam somente no arquivo `.env` local ou nas variaveis de ambiente da hospedagem.

Este repositorio nao publica:

- tokens de bot;
- chaves de API;
- URLs privadas da API;
- URI de banco de dados;
- exemplos completos de `.env`;
- dados de clientes.

## Desenvolvimento

Instale as dependencias:

```bash
npm install
```

Inicie o projeto:

```bash
npm start
```

Para compilar a API TypeScript:

```bash
npm run build
```

## Seguranca

Nunca publique o arquivo `.env`.

Configure tokens, chaves, URLs e banco de dados diretamente no ambiente da hospedagem ou em um arquivo `.env` local privado.
