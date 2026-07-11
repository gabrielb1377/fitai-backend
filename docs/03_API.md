# API - Biblioteca de Planos Prontos

Base local: `http://localhost:3001`

Os endpoints da Biblioteca de Planos Prontos sao publicos nesta etapa. Eles nao exigem JWT e nao alteram os fluxos existentes de IA, autenticacao ou planos manuais.

Antes de consultar os dados, aplique a migration e execute o seed:

```powershell
npm run prisma:migrate
npm run ready-plans:seed
```

O seed e idempotente: pode ser executado novamente para atualizar os 13 planos fixos do catalogo sem duplicar registros.

## GET /ready-plans

Retorna os resumos de todos os planos ativos da biblioteca.

```powershell
curl.exe http://localhost:3001/ready-plans
```

Resposta:

```json
{
  "plans": [
    {
      "id": "uuid",
      "slug": "abc-classico",
      "nome": "ABC Classico",
      "descricao": "Rotina direta para academia com divisao muscular tradicional.",
      "capa": "/images/ready-plans/abc-classico.jpg",
      "categoria": "ABC",
      "nivel": "Iniciante",
      "objetivo": "Hipertrofia",
      "divisao": "ABC",
      "diasPorSemana": 3,
      "tempoEstimado": 55,
      "totalDias": 3
    }
  ]
}
```

## GET /ready-plans/:id

Retorna um plano completo, incluindo dias e exercicios ordenados. O parametro `id` deve ser um UUID retornado por `GET /ready-plans`.

```powershell
curl.exe http://localhost:3001/ready-plans/<id>
```

Resposta:

```json
{
  "plan": {
    "id": "uuid",
    "slug": "abc-classico",
    "nome": "ABC Classico",
    "descricao": "Rotina direta para academia com divisao muscular tradicional.",
    "capa": "/images/ready-plans/abc-classico.jpg",
    "categoria": "ABC",
    "nivel": "Iniciante",
    "objetivo": "Hipertrofia",
    "divisao": "ABC",
    "diasPorSemana": 3,
    "tempoEstimado": 55,
    "dias": [
      {
        "id": "uuid",
        "nome": "Dia A",
        "titulo": "Peito + Triceps",
        "diaSemana": "Segunda",
        "grupoMuscular": "Peito + Triceps",
        "ordem": 1,
        "exercicios": [
          {
            "id": "uuid",
            "nome": "Supino reto com barra",
            "categoria": "Peito",
            "musculos": ["Peito", "Triceps"],
            "equipamentos": ["barra", "banco"],
            "series": 3,
            "repeticoes": "10-12",
            "descanso": 75,
            "ordem": 1
          }
        ]
      }
    ]
  }
}
```

Erros esperados:

- `400 invalid_ready_plan_id`: identificador fora do formato UUID.
- `404 ready_plan_not_found`: plano inexistente ou inativo.

## GET /ready-plans/categories

Retorna as 13 categorias oficiais da biblioteca e a quantidade de planos ativos em cada uma.

```powershell
curl.exe http://localhost:3001/ready-plans/categories
```

Resposta:

```json
{
  "categories": [
    {
      "id": "hipertrofia",
      "name": "Hipertrofia",
      "planCount": 1
    },
    {
      "id": "abc",
      "name": "ABC",
      "planCount": 1
    }
  ]
}
```
