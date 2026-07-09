const { z } = require("zod");

const registerSchema = z.object({
  name: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres."),
  email: z.string().trim().toLowerCase().email("Email invalido."),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres.")
}).strict();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email invalido."),
  password: z.string().min(1, "Senha e obrigatoria.")
}).strict();

function formatZodErrors(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message
  }));
}

module.exports = {
  registerSchema,
  loginSchema,
  formatZodErrors
};
