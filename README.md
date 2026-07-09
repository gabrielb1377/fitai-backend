# FitIA Backend

Backend separado em Node.js para servir a API de IA do FitIA.

Esta base nao chama a OpenAI ainda. O endpoint de treino retorna um JSON mockado no formato esperado pelo app, deixando a estrutura pronta para trocar o service por uma integracao real depois.

## Regras de escopo

- O projeto Flutter em `C:\fitai` nao deve ser alterado por este backend.
- A chave da OpenAI deve ficar apenas no backend.
- O Flutter deve chamar esta API, nao a OpenAI diretamente.
- A implementacao atual usa mock e nao faz chamadas externas.
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

### POST /ai/generate-workout

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
  "prioridades": ["peito", "costas"]
}
```

Resposta mockada:

```json
{
  "nome": "ABCD - Hipertrofia",
  "descricao": "Treino mockado para hipertrofia, nivel intermediario, 4 dias por semana, 60 minutos por treino, local: academia",
  "objetivo": "hipertrofia",
  "nivel": "intermediario",
  "dias": [
    {
      "nome": "Dia A",
      "grupo": "Peito + Triceps",
      "exercicios": [
        {
          "nome": "Supino reto",
          "series": 4,
          "repeticoes": "8-12",
          "descansoSegundos": 75,
          "observacoes": "Mock inicial usando barra, halteres, maquinas. Ajustar pela IA real depois."
        }
      ]
    }
  ]
}
```

## Proximo passo

Quando for ativar a IA real, substitua a logica de `src/modules/ai/service/workout_ai.service.js` por uma chamada segura no backend usando `OPENAI_API_KEY` do `.env`.
