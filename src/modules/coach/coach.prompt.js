const coachInsightJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "categoria", "prioridade", "titulo", "descricao", "acao", "exercicioId"],
  properties: {
    id: { type: "string" },
    categoria: {
      type: "string",
      enum: [
        "progressao",
        "recuperacao",
        "frequencia",
        "recorde",
        "meta",
        "corrida",
        "equilibrio_muscular",
        "sugestao"
      ]
    },
    prioridade: {
      type: "string",
      enum: ["baixa", "media", "alta"]
    },
    titulo: { type: "string" },
    descricao: { type: "string" },
    acao: { type: "string" },
    exercicioId: {
      anyOf: [
        { type: "string" },
        { type: "null" }
      ]
    }
  }
};

const coachResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["resumo", "insights", "geradoEm"],
  properties: {
    resumo: { type: "string" },
    insights: {
      type: "array",
      maxItems: 8,
      items: coachInsightJsonSchema
    },
    geradoEm: { type: "string" }
  }
};

function buildCoachPrompt(input, context) {
  return {
    instructions: [
      "Voce e o Coach FitIA, um assistente de treino e evolucao fisica.",
      "Gere insights curtos, uteis, especificos e acionaveis.",
      "Use somente os dados fornecidos no contexto; nao invente historico, recordes, metas ou sintomas.",
      "Nao faca diagnostico medico, nao recomende tratamento e nao substitua profissional de saude.",
      "Responda somente com JSON valido no schema solicitado.",
      "Nao inclua markdown, comentarios, texto extra ou chaves fora do schema."
    ].join(" "),
    input: [
      "Pedido do usuario:",
      JSON.stringify({
        tipo: input.tipo,
        exercicioId: input.exercicioId,
        periodoDias: input.periodoDias
      }, null, 2),
      "",
      "Resumo seguro do contexto:",
      JSON.stringify(context.summary, null, 2),
      "",
      "Analise local calculada antes da IA:",
      JSON.stringify(context.analysis, null, 2),
      "",
      "Amostra de dados disponiveis:",
      JSON.stringify(buildContextSample(context), null, 2),
      "",
      "Regras obrigatorias:",
      "- Retorne no maximo 8 insights.",
      "- descricao deve ter no maximo 180 caracteres.",
      "- acao deve ter no maximo 120 caracteres.",
      "- prioridade deve ser baixa, media ou alta.",
      "- categoria deve ser progressao, recuperacao, frequencia, recorde, meta, corrida, equilibrio_muscular ou sugestao.",
      "- Se o tipo for exercicio, priorize o exercicioId informado quando houver dados.",
      "- Se faltar historico, diga isso com honestidade e sugira o proximo registro util.",
      "- Nao exponha token, senha, email, segredo, chave de API nem dados sensiveis.",
      "- Escreva em portugues do Brasil."
    ].join("\n"),
    responseFormat: {
      type: "json_schema",
      name: "fitai_coach_insights",
      strict: true,
      schema: coachResponseJsonSchema
    }
  };
}

function buildContextSample(context) {
  return {
    perfil: context.raw.perfil || {},
    treinosRecentes: context.raw.historicoTreinos.slice(0, 8),
    exerciciosRecentes: context.raw.historicoExercicios.slice(0, 12),
    recordesRecentes: context.raw.recordes.slice(0, 8),
    metasRecentes: context.raw.metas.slice(0, 8),
    corridasRecentes: context.raw.corridas.slice(0, 8),
    passosRecentes: (context.raw.passos || []).slice(0, 10)
  };
}

module.exports = {
  coachResponseJsonSchema,
  buildCoachPrompt
};
