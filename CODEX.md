# Codex - FitIA Backend

Leia primeiro o guia completo em [..\docs\CODEX_RULES.md](..\docs\CODEX_RULES.md).

- Preserve a arquitetura modular: `routes`, `controller`, `service` e `schemas` por dominio quando aplicavel.
- Use Zod para entrada, Prisma e PostgreSQL para persistencia, e transactions para operacoes com multiplas escritas.
- Proteja recursos por JWT e usuario. Nunca retorne `passwordHash`, exponha segredos em logs ou confie no payload do cliente.
- OpenAI existe somente no backend; valide respostas, mantenha fallback seguro e nao registre prompts sensiveis completos.
- Nao altere migrations antigas. Crie migration nova para cada mudanca de schema e execute a validacao do Prisma.
- Use idempotencia para operacoes sensiveis e preserve contratos que o Flutter ja consome.
- Mantenha `GET /health` e `npm run dev` funcionando. Teste endpoints alterados e informe validacoes nao executadas.
