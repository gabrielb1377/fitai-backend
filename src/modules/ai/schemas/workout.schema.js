const REQUIRED_FIELDS = {
  objetivo: "string",
  divisao: "string",
  nivel: "string",
  diasPorSemana: "number",
  tempoPorTreino: "number",
  local: "string",
  equipamentos: "array",
  restricoes: "array",
  prioridades: "array"
};

const OPTIONAL_FIELDS = {
  observacoes: "string",
  minExerciciosPorDia: "number"
};

function validateWorkoutRequest(body) {
  const errors = [];
  const data = body && typeof body === "object" && !Array.isArray(body) ? body : {};

  Object.entries(REQUIRED_FIELDS).forEach(([field, expectedType]) => {
    if (!(field in data)) {
      errors.push(`${field} e obrigatorio.`);
      return;
    }

    if (!matchesType(data[field], expectedType)) {
      errors.push(`${field} deve ser ${expectedType}.`);
    }
  });

  Object.entries(OPTIONAL_FIELDS).forEach(([field, expectedType]) => {
    if (field in data && !matchesType(data[field], expectedType)) {
      errors.push(`${field} deve ser ${expectedType}.`);
    }
  });

  if (typeof data.diasPorSemana === "number" && data.diasPorSemana < 1) {
    errors.push("diasPorSemana deve ser maior que zero.");
  }

  if (typeof data.tempoPorTreino === "number" && data.tempoPorTreino < 1) {
    errors.push("tempoPorTreino deve ser maior que zero.");
  }

  if (
    data.minExerciciosPorDia !== undefined &&
    ![6, 7, 8, 9, 10].includes(data.minExerciciosPorDia)
  ) {
    errors.push("minExerciciosPorDia deve ser 6, 7, 8, 9 ou 10.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data: normalizeWorkoutRequest(data)
  };
}

function matchesType(value, expectedType) {
  if (expectedType === "array") {
    return Array.isArray(value);
  }

  return typeof value === expectedType;
}

function normalizeWorkoutRequest(data) {
  return {
    objetivo: normalizeString(data.objetivo),
    divisao: normalizeString(data.divisao),
    nivel: normalizeString(data.nivel),
    diasPorSemana: Number(data.diasPorSemana),
    tempoPorTreino: Number(data.tempoPorTreino),
    local: normalizeString(data.local),
    equipamentos: normalizeStringArray(data.equipamentos),
    restricoes: normalizeStringArray(data.restricoes),
    prioridades: normalizeStringArray(data.prioridades),
    minExerciciosPorDia: normalizeMinExercises(data.minExerciciosPorDia),
    observacoes: normalizeString(data.observacoes)
  };
}

function normalizeMinExercises(value) {
  const number = Number(value);

  return [6, 7, 8, 9, 10].includes(number) ? number : 6;
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  validateWorkoutRequest
};
