# FitIA Backend

Backend separado em Node.js para servir a API de IA do FitIA.

Esta base nao chama a OpenAI ainda. O endpoint de treino retorna um JSON mockado no formato esperado pelo app, deixando a estrutura pronta para trocar o service por uma integracao real depois.

## Regras de escopo

- O projeto Flutter em `C:\fitai` nao deve ser alterado por este backend.
- A chave da OpenAI deve ficar apenas no backend.
- O Flutter deve chamar esta API, nao a OpenAI diretamente.
- A implementacao atual usa mock e nao faz chamadas externas.

## Estrutura

```text
C:\fitai-backend
|-- package.json
|-- .env.example
|-- README.md
`-- src
    |-- server.js
    |-- routes
    |   `-- ai.routes.js
    |-- services
    |   `-- workout_ai.service.js
    `-- schemas
        `-- workout.schema.js
```

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

## Scripts

```powershell
npm start
npm run dev
npm run check
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

Quando for ativar a IA real, substitua a logica de `src/services/workout_ai.service.js` por uma chamada segura no backend usando `OPENAI_API_KEY` do `.env`.
