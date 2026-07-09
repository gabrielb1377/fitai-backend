const { workoutResponseJsonSchema } = require("./workout.validator");

function buildWorkoutPrompt(input) {
  return {
    instructions: [
      "Voce e um especialista em treinamento fisico do FitIA.",
      "Gere um treino seguro, pratico e coerente com os parametros recebidos.",
      "Responda somente com JSON valido no schema solicitado.",
      "Nao inclua markdown, comentarios, texto extra ou chaves fora do schema."
    ].join(" "),
    input: [
      "Parametros do usuario:",
      JSON.stringify(input, null, 2),
      "",
      "Regras de geracao:",
      "- A resposta deve ser compativel com o TreinoModel do Flutter.",
      "- Preencha sempre id, nome, descricao, objetivo, nivel, tempoEstimado, criadoPorIA, dataCriacao, dias e exercicios.",
      "- criadoPorIA deve ser true.",
      "- tempoEstimado deve ser numerico e preferencialmente igual a tempoPorTreino.",
      "- dias deve ter pelo menos um item e cada dia deve ter pelo menos um exercicio.",
      "- Use nomes de dias como Dia A, Dia B, Dia C conforme a divisao.",
      "- Monte grupos musculares coerentes com objetivo, nivel, local e equipamentos.",
      "- Cada exercicio deve conter id, nome, categoria, musculos, equipamentos, series, repeticoes e descanso.",
      "- Respeite restricoes e prioridades quando informadas.",
      "- Use portugues do Brasil."
    ].join("\n"),
    responseFormat: {
      type: "json_schema",
      name: "fitai_workout",
      strict: true,
      schema: workoutResponseJsonSchema
    }
  };
}

module.exports = {
  buildWorkoutPrompt
};
