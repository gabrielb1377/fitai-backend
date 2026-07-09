# FitIA Backend

Backend separado em Node.js para servir a API de IA do FitIA.

Esta base prepara a geracao real de treinos com OpenAI e preserva modo mock quando `OPENAI_API_KEY` nao estiver configurada.

## Regras de escopo

- O projeto Flutter em `C:\fitai` nao deve ser alterado por este backend.
- A chave da OpenAI deve ficar apenas no backend.
- O Flutter deve chamar esta API, nao a OpenAI diretamente.
- Sem `OPENAI_API_KEY`, a implementacao usa mock e nao faz chamadas externas.
- A autenticacao JWT existe no backend, mas ainda nao foi integrada ao Flutter.

## Arquitetura

O projeto usa uma organizacao modular:

- `src/server.js`: ponto de entrada do processo HTTP.
- `src/app.js`: cria e configura o app Express.
- `src/config`: configuracoes de ambiente, Prisma Client e constantes da aplicacao.
- `src/shared`: codigo reutilizavel entre modulos, como middlewares, utils e erros.
- `src/modules`: modulos de dominio do FitIA.
- `prisma/schema.prisma`: schema inicial do banco PostgreSQL.
- `prisma.config.js`: configuracao da CLI do Prisma.

```text
C:\fitai-backend
|-- package.json
|-- .env.example
|-- prisma.config.js
|-- README.md
|-- prisma
|   `-- schema.prisma
`-- src
    |-- app.js
    |-- server.js
    |-- config
    |   |-- database.js
    |   |-- env.js
    |   `-- prisma.js
    |-- shared
    |   |-- errors
    |   |   `-- app-error.js
    |   |-- middleware
    |   |   |-- error-handler.middleware.js
    |   |   `-- not-found.middleware.js
    |   `-- utils
    |       `-- async-handler.js
    `-- modules
        |-- ai
        |   |-- openai.service.js
        |   |-- prompt.builder.js
        |   |-- response.parser.js
        |   |-- workout.validator.js
        |   |-- controller
        |   |   `-- ai.controller.js
        |   |-- routes
        |   |   `-- ai.routes.js
        |   |-- schemas
        |   |   `-- workout.schema.js
        |   `-- service
        |       `-- workout_ai.service.js
        |-- auth
        |   |-- auth.controller.js
        |   |-- auth.middleware.js
        |   |-- auth.routes.js
        |   |-- auth.schemas.js
        |   `-- auth.service.js
        |-- users
        |   |-- controller
        |   |   `-- users.controller.js
        |   |-- dto
        |   |   `-- user.dto.js
        |   |-- routes
        |   |   `-- users.routes.js
        |   |-- schemas
        |   |   `-- users.schemas.js
        |   `-- service
        |       `-- users.service.js
        |-- workouts
        |-- exercises
        |-- running
        |-- goals
        |-- records
        `-- coach
```

Cada modulo deve concentrar as camadas que fizerem sentido para aquele dominio:

- `routes`: define as rotas HTTP do modulo.
- `controller`: recebe a requisicao e monta a resposta HTTP.
- `service`: concentra regras de negocio e integracoes externas.
- `schemas`: valida e normaliza dados de entrada quando necessario.

## Configuracao

```powershell
cd C:\fitai-backend
copy .env.example .env
npm install
npm run dev
```

Por padrao, a API sobe em:

```text
http://localhost:3001
```

Configure tambem as variaveis de JWT no arquivo `.env`:

```env
JWT_SECRET="troque-por-um-segredo-forte"
JWT_EXPIRES_IN=7d
```

Em desenvolvimento, se `JWT_SECRET` nao for informado, o backend usa um fallback local apenas para manter `npm run dev` funcionando.

## OpenAI

A integracao com OpenAI fica isolada no modulo `src/modules/ai` e ainda nao foi conectada ao Flutter.

Configure as variaveis no `.env`:

```env
OPENAI_API_KEY="sua_chave_openai"
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT_MS=30000
OPENAI_MAX_RETRIES=2
```

### Modo mock

Se `OPENAI_API_KEY` estiver vazia ou ausente, `POST /ai/generate-workout` usa o gerador mock local. Esse modo mantem o contrato atual do app e permite rodar o backend sem chamadas externas.

### Modo producao

Com `OPENAI_API_KEY` configurada, o fluxo de geracao passa por:

```text
body validado
-> prompt.builder.js
-> openai.service.js
-> Responses API
-> response.parser.js
-> workout.validator.js
-> JSON final do treino
```

O SDK oficial da OpenAI esta configurado com timeout e retry automatico via `OPENAI_TIMEOUT_MS` e `OPENAI_MAX_RETRIES`. Erros da OpenAI sao padronizados pelo middleware global de erros.

## PostgreSQL e Prisma

Instale o PostgreSQL localmente e deixe o servico rodando na porta padrao `5432`.

Crie o usuario e o banco local:

```sql
CREATE USER fitai_user WITH PASSWORD 'fitai_password';
CREATE DATABASE fitai_db OWNER fitai_user;
GRANT ALL PRIVILEGES ON DATABASE fitai_db TO fitai_user;
```

Se necessario, garanta permissao no schema `public`:

```sql
\c fitai_db
GRANT ALL ON SCHEMA public TO fitai_user;
```

Configure a variavel `DATABASE_URL` no arquivo `.env`:

```env
DATABASE_URL="postgresql://fitai_user:fitai_password@localhost:5432/fitai_db?schema=public"
```

O schema inicial esta em `prisma/schema.prisma`. Ele prepara os modelos base de usuario, perfil, treinos, exercicios, historicos, corrida, metas e recordes.

Teste a conexao:

```powershell
npm run db:test
```

Ao iniciar com `npm run dev`, o backend tambem tenta conectar ao PostgreSQL. Se conectar, mostra:

```text
✓ PostgreSQL conectado
```

Se falhar, mostra uma mensagem amigavel e o servidor continua rodando.

Gere o Prisma Client:

```powershell
npm run prisma:generate
```

Rode uma migration somente depois que o PostgreSQL local, o banco e o usuario existirem:

```powershell
npm run prisma:migrate
```

Esse comando usa o schema ja existente em `prisma/schema.prisma`. Nenhum novo modelo foi adicionado nesta etapa.

Abra o Prisma Studio:

```powershell
npm run prisma:studio
```

Nenhuma migration foi criada nesta preparacao.

## Scripts

```powershell
npm start
npm run dev
npm run check
npm test
npm run db:test
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
```

## Endpoints

### GET /health

Resposta esperada:

```json
{
  "status": "ok",
  "service": "fitai-backend",
  "timestamp": "2026-07-08T00:00:00.000Z"
}
```

### POST /auth/register

Cria um usuario, cria um perfil inicial e retorna o usuario sem `passwordHash` junto com o token JWT.

Body:

```json
{
  "name": "Gabriel",
  "email": "teste@email.com",
  "password": "123456"
}
```

Resposta:

```json
{
  "user": {
    "id": "uuid",
    "name": "Gabriel",
    "email": "teste@email.com",
    "createdAt": "2026-07-08T00:00:00.000Z",
    "updatedAt": "2026-07-08T00:00:00.000Z",
    "profile": {
      "id": "uuid",
      "userId": "uuid",
      "weight": 0,
      "height": 0,
      "age": 0,
      "goal": "",
      "level": "",
      "createdAt": "2026-07-08T00:00:00.000Z",
      "updatedAt": "2026-07-08T00:00:00.000Z"
    }
  },
  "token": "jwt"
}
```

### POST /auth/login

Valida email e senha com bcrypt e retorna um JWT.

Body:

```json
{
  "email": "teste@email.com",
  "password": "123456"
}
```

Resposta:

```json
{
  "user": {
    "id": "uuid",
    "name": "Gabriel",
    "email": "teste@email.com",
    "createdAt": "2026-07-08T00:00:00.000Z",
    "updatedAt": "2026-07-08T00:00:00.000Z",
    "profile": {}
  },
  "token": "jwt"
}
```

### GET /auth/me

Retorna o usuario autenticado.

Header:

```http
Authorization: Bearer <token>
```

Resposta:

```json
{
  "user": {
    "id": "uuid",
    "name": "Gabriel",
    "email": "teste@email.com",
    "createdAt": "2026-07-08T00:00:00.000Z",
    "updatedAt": "2026-07-08T00:00:00.000Z",
    "profile": {}
  }
}
```

### Middleware JWT

O middleware `authenticateJWT` esta em `src/modules/auth/auth.middleware.js` e pode ser usado para proteger rotas futuras:

```js
const { authenticateJWT } = require("../auth/auth.middleware");

router.get("/rota-protegida", authenticateJWT, controller);
```

### GET /users

Lista usuarios. Rota protegida por JWT.

Exemplo:

```powershell
curl.exe -H "Authorization: Bearer <token>" http://localhost:3001/users
```

Resposta:

```json
{
  "users": [
    {
      "id": "uuid",
      "name": "Gabriel",
      "email": "teste@email.com",
      "createdAt": "2026-07-08T00:00:00.000Z",
      "updatedAt": "2026-07-08T00:00:00.000Z",
      "profile": {}
    }
  ]
}
```

`passwordHash` nunca e retornado.

### GET /users/:id

Busca um usuario por ID. Rota protegida por JWT.

Exemplo:

```powershell
curl.exe -H "Authorization: Bearer <token>" http://localhost:3001/users/<userId>
```

Resposta:

```json
{
  "user": {
    "id": "uuid",
    "name": "Gabriel",
    "email": "teste@email.com",
    "createdAt": "2026-07-08T00:00:00.000Z",
    "updatedAt": "2026-07-08T00:00:00.000Z",
    "profile": {}
  }
}
```

### PATCH /users/:id

Atualiza dados basicos do usuario. Rota protegida por JWT. Senha nao e atualizada por este endpoint.

Body:

```json
{
  "name": "Gabriel FitIA",
  "email": "gabriel@email.com"
}
```

Exemplo:

```powershell
curl.exe -X PATCH http://localhost:3001/users/<userId> -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"name\":\"Gabriel FitIA\"}"
```

Resposta:

```json
{
  "user": {
    "id": "uuid",
    "name": "Gabriel FitIA",
    "email": "teste@email.com",
    "createdAt": "2026-07-08T00:00:00.000Z",
    "updatedAt": "2026-07-08T00:00:00.000Z",
    "profile": {}
  }
}
```

### DELETE /users/:id

Remove um usuario. Rota protegida por JWT.

Exemplo:

```powershell
curl.exe -X DELETE -H "Authorization: Bearer <token>" http://localhost:3001/users/<userId>
```

Resposta esperada:

```text
204 No Content
```

### GET /profile

Retorna o perfil do usuario autenticado. Rota protegida por JWT.

Exemplo:

```powershell
curl.exe -H "Authorization: Bearer <token>" http://localhost:3001/profile
```

Resposta:

```json
{
  "profile": {
    "id": "uuid",
    "userId": "uuid",
    "weight": 80,
    "height": 180,
    "age": 30,
    "goal": "hipertrofia",
    "level": "intermediario",
    "createdAt": "2026-07-08T00:00:00.000Z",
    "updatedAt": "2026-07-08T00:00:00.000Z"
  }
}
```

### PATCH /profile

Atualiza o perfil do usuario autenticado. Rota protegida por JWT.

Body:

```json
{
  "weight": 82,
  "height": 180,
  "age": 30,
  "goal": "hipertrofia",
  "level": "intermediario"
}
```

Exemplo:

```powershell
curl.exe -X PATCH http://localhost:3001/profile -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"weight\":82,\"goal\":\"hipertrofia\"}"
```

Resposta:

```json
{
  "profile": {
    "id": "uuid",
    "userId": "uuid",
    "weight": 82,
    "height": 180,
    "age": 30,
    "goal": "hipertrofia",
    "level": "intermediario",
    "createdAt": "2026-07-08T00:00:00.000Z",
    "updatedAt": "2026-07-08T00:00:00.000Z"
  }
}
```

### POST /ai/generate-workout

Gera um treino sempre compativel com o `TreinoModel` do Flutter. Se a OpenAI retornar JSON incompleto, o backend normaliza e preenche campos obrigatorios. Se a resposta vier invalida ou a chamada falhar, aplica fallback mock.

Body esperado:

```json
{
  "objetivo": "hipertrofia",
  "divisao": "ABCD",
  "nivel": "intermediario",
  "diasPorSemana": 4,
  "tempoPorTreino": 60,
  "local": "academia",
  "equipamentos": ["barra", "halteres", "maquinas"],
  "restricoes": [],
  "prioridades": ["peito", "costas"],
  "observacoes": ""
}
```

Resposta:

```json
{
  "id": "7e0f6e54-62d4-46da-93a4-6c10e3f0e2d1",
  "nome": "ABCD - Hipertrofia",
  "descricao": "Treino gerado para hipertrofia, nivel intermediario, 4 dias por semana, 60 minutos por treino, local: academia",
  "objetivo": "hipertrofia",
  "nivel": "intermediario",
  "tempoEstimado": 60,
  "criadoPorIA": true,
  "dataCriacao": "2026-07-09T12:00:00.000Z",
  "dias": [
    {
      "id": "d2fbba0c-1abf-4dc9-9efa-49210087b38e",
      "nome": "Dia A",
      "titulo": "Peito + Triceps",
      "diaSemana": "Segunda",
      "exercicios": [
        {
          "id": "db6757fa-9297-4bc4-8fb7-058b869e0e5d",
          "nome": "Supino reto",
          "categoria": "Peito + Triceps",
          "musculos": ["Peito", "Triceps"],
          "equipamentos": ["barra", "halteres", "maquinas"],
          "series": 4,
          "repeticoes": "8-12",
          "descanso": 90
        }
      ]
    }
  ],
  "exercicios": []
}
```

Arquivos de exemplo:

- `docs/examples/generate-workout.request.json`
- `docs/examples/generate-workout.response.json`

### Testar no Postman ou Insomnia

1. Crie uma requisicao `POST`.
2. Use a URL `http://localhost:3001/ai/generate-workout`.
3. Em `Headers`, defina `Content-Type: application/json`.
4. Em `Body`, selecione `raw` e `JSON`.
5. Cole o conteudo de `docs/examples/generate-workout.request.json`.
6. Envie a requisicao e compare a resposta com `docs/examples/generate-workout.response.json`.

O endpoint nao exige JWT hoje, para preservar o contrato atual da IA. As rotas de usuarios e perfil continuam protegidas.

## Proximo passo

Depois que o Flutter for conectado, validar o parse do `TreinoModel` no app usando o JSON de exemplo deste backend.
