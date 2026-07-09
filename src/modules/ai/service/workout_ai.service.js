const { isOpenAIEnabled, generateWorkoutWithOpenAI } = require("../openai.service");

const GROUPS_BY_SPLIT = {
  ABCD: [
    { nome: "Dia A", grupo: "Peito + Triceps" },
    { nome: "Dia B", grupo: "Costas + Biceps" },
    { nome: "Dia C", grupo: "Pernas" },
    { nome: "Dia D", grupo: "Ombros + Abdomen" }
  ],
  ABC: [
    { nome: "Dia A", grupo: "Peito + Ombros + Triceps" },
    { nome: "Dia B", grupo: "Costas + Biceps" },
    { nome: "Dia C", grupo: "Pernas + Abdomen" }
  ],
  AB: [
    { nome: "Dia A", grupo: "Membros superiores" },
    { nome: "Dia B", grupo: "Membros inferiores" }
  ],
  FULL_BODY: [
    { nome: "Dia A", grupo: "Corpo inteiro" }
  ]
};

const EXERCISES_BY_GROUP = {
  "Peito + Triceps": [
    "Supino reto",
    "Supino inclinado com halteres",
    "Crucifixo na maquina",
    "Triceps corda"
  ],
  "Costas + Biceps": [
    "Puxada frontal",
    "Remada baixa",
    "Remada curvada",
    "Rosca direta"
  ],
  Pernas: [
    "Agachamento livre",
    "Leg press",
    "Cadeira extensora",
    "Mesa flexora"
  ],
  "Ombros + Abdomen": [
    "Desenvolvimento com halteres",
    "Elevacao lateral",
    "Face pull",
    "Prancha"
  ],
  "Peito + Ombros + Triceps": [
    "Supino reto",
    "Desenvolvimento com halteres",
    "Crucifixo na maquina",
    "Triceps pulley"
  ],
  "Pernas + Abdomen": [
    "Agachamento livre",
    "Leg press",
    "Cadeira extensora",
    "Prancha"
  ],
  "Membros superiores": [
    "Supino reto",
    "Puxada frontal",
    "Desenvolvimento com halteres",
    "Rosca direta"
  ],
  "Membros inferiores": [
    "Agachamento livre",
    "Leg press",
    "Mesa flexora",
    "Panturrilha em pe"
  ],
  "Corpo inteiro": [
    "Agachamento livre",
    "Supino reto",
    "Puxada frontal",
    "Desenvolvimento com halteres"
  ]
};

async function generateWorkout(input) {
  if (isOpenAIEnabled()) {
    return generateWorkoutWithOpenAI(input);
  }

  console.info("[ai] OPENAI_API_KEY ausente. Usando modo mock para gerar treino.");

  return generateMockWorkout(input);
}

function generateMockWorkout(input) {
  const divisao = normalizeSplit(input.divisao);
  const groups = GROUPS_BY_SPLIT[divisao] || GROUPS_BY_SPLIT.ABCD;
  const selectedGroups = groups.slice(0, Math.min(input.diasPorSemana, groups.length));
  const objectiveName = capitalize(input.objetivo);

  return {
    nome: `${divisao} - ${objectiveName}`,
    descricao: buildDescription(input),
    objetivo: input.objetivo,
    nivel: input.nivel,
    dias: selectedGroups.map((day) => ({
      nome: day.nome,
      grupo: day.grupo,
      exercicios: buildExercisesForGroup(day.grupo, input)
    }))
  };
}

function buildDescription(input) {
  return [
    `Treino mockado para ${input.objetivo}`,
    `nivel ${input.nivel}`,
    `${input.diasPorSemana} dias por semana`,
    `${input.tempoPorTreino} minutos por treino`,
    `local: ${input.local}`
  ].join(", ");
}

function buildExercisesForGroup(group, input) {
  const baseExercises = EXERCISES_BY_GROUP[group] || EXERCISES_BY_GROUP["Corpo inteiro"];

  return baseExercises.map((name, index) => ({
    nome: name,
    series: index === 0 ? 4 : 3,
    repeticoes: input.objetivo === "forca" ? "4-6" : "8-12",
    descansoSegundos: input.objetivo === "forca" ? 120 : 75,
    observacoes: buildExerciseNote(input)
  }));
}

function buildExerciseNote(input) {
  const equipmentList = input.equipamentos.length > 0
    ? input.equipamentos.join(", ")
    : "equipamentos informados pelo app";

  return `Mock inicial usando ${equipmentList}. Ajustar pela IA real depois.`;
}

function normalizeSplit(split) {
  return String(split || "")
    .trim()
    .toUpperCase()
    .replace("-", "_")
    .replace(" ", "_");
}

function capitalize(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "Treino";
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

module.exports = {
  generateWorkout,
  generateMockWorkout
};
