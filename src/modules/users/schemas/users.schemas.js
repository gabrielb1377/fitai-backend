const { z } = require("zod");

const userIdParamsSchema = z.object({
  id: z.string().uuid("ID de usuario invalido.")
}).strict();

const updateUserSchema = z.object({
  name: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres.").optional(),
  email: z.string().trim().toLowerCase().email("Email invalido.").optional()
}).strict().refine(hasAtLeastOneField, {
  message: "Informe ao menos um campo para atualizar."
});

const updateProfileSchema = z.object({
  weight: z.number().nonnegative("Peso nao pode ser negativo.").optional(),
  height: z.number().nonnegative("Altura nao pode ser negativa.").optional(),
  age: z.number().int("Idade deve ser um numero inteiro.").min(0, "Idade nao pode ser negativa.").max(130, "Idade invalida.").optional(),
  goal: z.string().trim().max(120, "Objetivo deve ter no maximo 120 caracteres.").optional(),
  level: z.string().trim().max(60, "Nivel deve ter no maximo 60 caracteres.").optional()
}).strict().refine(hasAtLeastOneField, {
  message: "Informe ao menos um campo para atualizar."
});

function hasAtLeastOneField(value) {
  return Object.keys(value).length > 0;
}

function formatZodErrors(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message
  }));
}

module.exports = {
  userIdParamsSchema,
  updateUserSchema,
  updateProfileSchema,
  formatZodErrors
};
