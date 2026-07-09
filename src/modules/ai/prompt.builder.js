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
      "- Use nomes de dias como Dia A, Dia B, Dia C conforme a divisao.",
      "- Monte grupos musculares coerentes com objetivo, nivel, local e equipamentos.",
      "- Cada dia deve conter exercicios com nome, series, repeticoes, descansoSegundos e observacoes.",
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
