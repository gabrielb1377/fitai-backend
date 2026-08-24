const OpenAI = require("openai");
const { randomUUID } = require("crypto");
const env = require("../../config/env");
const AppError = require("../../shared/errors/app-error");
const { buildCoachContext } = require("./coach.context");
const { buildCoachPrompt } = require("./coach.prompt");
const { parseCoachResponse, normalizeCoachResponse } = require("./coach.parser");

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();
let openaiClient;

async function generateCoachInsights(userId, input, dependencies = {}) {
  const context = await buildCoachContext(userId, input);
  const cacheKey = buildCacheKey(context, input);
  const cached = !input.forceRefresh ? getCached(cacheKey) : null;

  logCoach(
    `usuario=${context.source === "database" ? "autenticado" : "anonimo"} tipo=${input.tipo} contexto=${context.source} forceRefresh=${input.forceRefresh}`
  );
  logCoach(
    `contexto_carregado treinos=${context.summary.treinosConcluidos} series=${context.summary.series} metas=${context.summary.metas} corridas=${context.summary.corridas}`
  );

  if (cached) {
    logCoach("cache=hit");
    return cached;
  }

  logCoach("cache=miss");

  if (!env.openaiApiKey) {
    logCoach("modo=MOCK reason=openai_api_key_ausente");
    const fallback = buildLocalCoachResponse(context, input, "mock");
    setCached(cacheKey, fallback);
    return fallback;
  }

  try {
    logCoach(`modo=OPENAI model=${env.openaiModel}`);
    const prompt = buildCoachPrompt(input, context);
    const client = dependencies.client || getOpenAIClient();
    const response = await client.responses.create({
      model: env.openaiModel,
      instructions: prompt.instructions,
      input: prompt.input,
      text: {
        format: prompt.responseFormat
      },
      temperature: 0.3
    });
    const parsed = parseCoachResponse(response);

    logCoach(`openai=resposta_recebida request_id=${response._request_id || "indisponivel"}`);
    setCached(cacheKey, parsed);
    return parsed;
  } catch (err) {
    logCoach(`provider_failure code=${err && err.code ? err.code : "openai_error"}`);
    throw normalizeProviderError(err);
  }
}

function normalizeProviderError(err) {
  if (err instanceof AppError) return err;
  const status = Number(err && err.status);
  if (status === 429) {
    return new AppError("O provedor de IA esta temporariamente limitado.", 503, "ai_provider_rate_limited");
  }
  if (Number.isFinite(status) && status >= 500) {
    return new AppError("O provedor de IA esta indisponivel.", 502, "ai_provider_unavailable");
  }
  if (err && (err.name === "APIConnectionTimeoutError" || err.code === "ETIMEDOUT")) {
    return new AppError("O provedor de IA excedeu o tempo de resposta.", 504, "ai_provider_timeout");
  }
  return new AppError("Falha controlada ao consultar o provedor de IA.", 502, "ai_provider_failed");
}

function buildLocalCoachResponse(context, input, mode = "local") {
  const now = new Date();
  const analysis = context.analysis || {};
  const insights = [];
  const progression = Array.isArray(analysis.progressaoCarga) ? analysis.progressaoCarga : [];
  const goals = analysis.metas || [];
  const undertrained = analysis.gruposMusculares ? analysis.gruposMusculares.subtreinados || [] : [];
  const overtrained = analysis.gruposMusculares ? analysis.gruposMusculares.excessivos || [] : [];
  const frequency = Number(analysis.frequenciaSemanal || 0);
  const daysSinceLastWorkout = analysis.diasDesdeUltimoTreino;
  const steps = analysis.passos || {};
  const todaySteps = steps.hoje || {};

  if (frequency === 0) {
    insights.push(makeInsight({
      categoria: "frequencia",
      prioridade: "alta",
      titulo: "Sem treinos recentes",
      descricao: "Nao encontrei treinos concluidos nos ultimos 7 dias.",
      acao: "Registre o proximo treino para calibrar o Coach."
    }));
  } else if (frequency < 3) {
    insights.push(makeInsight({
      categoria: "frequencia",
      prioridade: "media",
      titulo: "Frequencia pode subir",
      descricao: `Voce registrou ${frequency} treino(s) nos ultimos 7 dias.`,
      acao: "Tente manter pelo menos 3 sessoes bem distribuidas."
    }));
  } else {
    insights.push(makeInsight({
      categoria: "frequencia",
      prioridade: "baixa",
      titulo: "Boa constancia semanal",
      descricao: `Foram ${frequency} treino(s) registrados nos ultimos 7 dias.`,
      acao: "Mantenha o ritmo e cuide da recuperacao entre sessoes."
    }));
  }

  if (typeof daysSinceLastWorkout === "number" && daysSinceLastWorkout >= 4) {
    insights.push(makeInsight({
      categoria: "recuperacao",
      prioridade: "alta",
      titulo: "Pausa longa detectada",
      descricao: `Seu ultimo treino registrado foi ha ${daysSinceLastWorkout} dias.`,
      acao: "Volte com carga moderada e foco em tecnica."
    }));
  }

  if (todaySteps.metaDiaria && todaySteps.faltam > 0) {
    insights.push(makeInsight({
      categoria: "meta",
      prioridade: "media",
      titulo: "Passos de hoje",
      descricao: `Faltam ${todaySteps.faltam} passos para sua meta de hoje.`,
      acao: "Inclua uma caminhada curta ou pequenos blocos ao longo do dia."
    }));
  }

  if (todaySteps.metaDiaria && todaySteps.passos >= todaySteps.metaDiaria) {
    insights.push(makeInsight({
      categoria: "meta",
      prioridade: "baixa",
      titulo: "Meta de passos concluida",
      descricao: `Voce completou a meta diaria com ${todaySteps.passos} passos.`,
      acao: "Mantenha o ritmo sem transformar todo dia em intensidade alta."
    }));
  }

  if (steps.variacaoMediaSemanalPercentual !== null && steps.variacaoMediaSemanalPercentual !== undefined) {
    insights.push(makeInsight({
      categoria: "frequencia",
      prioridade: steps.variacaoMediaSemanalPercentual >= 0 ? "baixa" : "media",
      titulo: "Media semanal de passos",
      descricao: `Sua media semanal variou ${steps.variacaoMediaSemanalPercentual}% frente aos 7 dias anteriores.`,
      acao: "Use essa tendencia para ajustar a meta sem pressa."
    }));
  }

  if (steps.diasMetaConcluida7 > 0) {
    insights.push(makeInsight({
      categoria: "meta",
      prioridade: steps.diasMetaConcluida7 >= 5 ? "baixa" : "media",
      titulo: "Consistencia nos passos",
      descricao: `Voce completou a meta em ${steps.diasMetaConcluida7} dos ultimos 7 dias.`,
      acao: "Busque mais um dia completo antes de aumentar a meta."
    }));
  }

  if (analysis.quedaVolume) {
    const drop = analysis.volume && analysis.volume.queda14DiasPercentual;
    insights.push(makeInsight({
      categoria: "recuperacao",
      prioridade: "media",
      titulo: "Volume recente caiu",
      descricao: drop === null || drop === undefined
        ? "O volume dos ultimos 14 dias ficou abaixo do periodo anterior."
        : `O volume dos ultimos 14 dias variou ${drop}% contra o periodo anterior.`,
      acao: "Revise sono, descanso e consistencia antes de subir carga."
    }));
  }

  const targetProgression = pickProgression(progression, input.exercicioId);

  if (targetProgression && targetProgression.variacaoPercentual !== null) {
    const isUp = targetProgression.variacaoPercentual >= 0;
    insights.push(makeInsight({
      categoria: "progressao",
      prioridade: isUp ? "baixa" : "media",
      titulo: isUp ? "Carga em evolucao" : "Carga perdeu ritmo",
      descricao: `${targetProgression.exercicio || "Exercicio"} variou ${targetProgression.variacaoPercentual}% frente ao registro anterior.`,
      acao: isUp ? "Mantenha reps limpas antes do proximo aumento." : "Repita a carga e busque execucao mais estavel.",
      exercicioId: targetProgression.exercicioId
    }));
  }

  if (analysis.melhorCargaRecente) {
    insights.push(makeInsight({
      categoria: "recorde",
      prioridade: "baixa",
      titulo: "Melhor carga recente",
      descricao: `${analysis.melhorCargaRecente.exercicio || "Exercicio"} chegou a ${analysis.melhorCargaRecente.carga} kg recentemente.`,
      acao: "Use esse valor como referencia para a proxima progressao.",
      exercicioId: analysis.melhorCargaRecente.exercicioId
    }));
  }

  if (undertrained.length > 0) {
    insights.push(makeInsight({
      categoria: "equilibrio_muscular",
      prioridade: "media",
      titulo: "Grupos pouco estimulados",
      descricao: `Pouco volume recente para: ${undertrained.slice(0, 3).join(", ")}.`,
      acao: "Inclua esses grupos no proximo ciclo se fizer sentido."
    }));
  }

  if (overtrained.length > 0) {
    insights.push(makeInsight({
      categoria: "recuperacao",
      prioridade: "media",
      titulo: "Volume concentrado",
      descricao: `Volume recente concentrado em: ${overtrained.slice(0, 3).join(", ")}.`,
      acao: "Evite repetir o mesmo grupo sem recuperacao adequada."
    }));
  }

  goals.slice(0, 2).forEach((goal) => {
    insights.push(makeInsight({
      categoria: "meta",
      prioridade: goal.progresso >= 0.8 ? "baixa" : "media",
      titulo: goal.progresso >= 0.8 ? "Meta quase la" : "Meta precisa de rotina",
      descricao: `${goal.titulo || "Meta"} esta em ${Math.round((goal.progresso || 0) * 100)}% do alvo.`,
      acao: "Transforme a meta em uma acao pequena para esta semana."
    }));
  });

  if (analysis.corrida && analysis.corrida.distanciaRecente > 0) {
    insights.push(makeInsight({
      categoria: "corrida",
      prioridade: "baixa",
      titulo: "Corrida registrada",
      descricao: `Voce somou ${analysis.corrida.distanciaRecente} km no periodo analisado.`,
      acao: "Mantenha progressao gradual de distancia ou ritmo."
    }));
  }

  if (analysis.sequenciaTreinos > 1) {
    insights.push(makeInsight({
      categoria: "frequencia",
      prioridade: "baixa",
      titulo: "Sequencia ativa",
      descricao: `Voce tem ${analysis.sequenciaTreinos} dia(s) seguidos com treino registrado.`,
      acao: "Planeje um dia leve se o cansaço acumular."
    }));
  }

  const filtered = filterInsightsByType(insights, input);
  const selected = (filtered.length > 0 ? filtered : insights).slice(0, 8);

  if (selected.length === 0) {
    selected.push(makeInsight({
      categoria: "sugestao",
      prioridade: "baixa",
      titulo: "Coach pronto para aprender",
      descricao: "Ainda ha poucos dados locais para gerar uma analise especifica.",
      acao: "Registre treinos, series, metas ou corridas para melhorar os insights."
    }));
  }

  const payload = {
    resumo: buildSummary(context, input, mode, selected.length),
    insights: selected,
    geradoEm: now.toISOString()
  };
  const normalized = normalizeCoachResponse(payload, { now });

  logCoach(`validacao_aplicada insights=${normalized.valid ? normalized.data.insights.length : 0}`);

  return normalized.valid ? normalized.data : {
    resumo: "Analise local FitIA gerada com dados limitados.",
    insights: [makeInsight({
      categoria: "sugestao",
      prioridade: "baixa",
      titulo: "Registre mais dados",
      descricao: "Nao encontrei dados suficientes para criar uma recomendacao detalhada.",
      acao: "Conclua um treino ou registre uma meta para o Coach analisar."
    })],
    geradoEm: now.toISOString()
  };
}

function makeInsight({ categoria, prioridade, titulo, descricao, acao, exercicioId = null }) {
  return {
    id: randomUUID(),
    categoria,
    prioridade,
    titulo,
    descricao,
    acao,
    exercicioId
  };
}

function pickProgression(progression, exercicioId) {
  if (!Array.isArray(progression) || progression.length === 0) {
    return null;
  }

  if (exercicioId) {
    const matched = progression.find((item) => item.exercicioId === exercicioId);
    if (matched) return matched;
  }

  return progression[0];
}

function filterInsightsByType(insights, input) {
  const type = input.tipo;

  if (type === "geral") return insights;
  if (type === "exercicio") {
    return insights.filter((insight) => (
      insight.exercicioId ||
      ["progressao", "recorde", "recuperacao"].includes(insight.categoria)
    ));
  }

  const byType = {
    progressao: ["progressao", "recorde"],
    recuperacao: ["recuperacao", "equilibrio_muscular"],
    frequencia: ["frequencia"],
    metas: ["meta"],
    corrida: ["corrida"]
  };
  const allowed = byType[type] || [];

  return insights.filter((insight) => allowed.includes(insight.categoria));
}

function buildSummary(context, input, mode, count) {
  if (context.summary.treinosConcluidos === 0 && context.summary.series === 0) {
    return "Coach FitIA gerou orientacoes com poucos dados historicos disponiveis.";
  }

  return `Coach FitIA analisou ${context.summary.treinosConcluidos} treino(s), ${context.summary.series} serie(s) e retornou ${count} insight(s) em modo ${mode}.`;
}

function buildCacheKey(context, input) {
  return [
    context.userKey,
    input.tipo,
    input.exercicioId || "geral",
    input.periodoDias
  ].join(":");
}

function getCached(key) {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCached(key, value) {
  cache.set(key, {
    value,
    createdAt: Date.now()
  });
}

function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: env.openaiApiKey,
      timeout: env.openaiTimeoutMs,
      maxRetries: env.openaiMaxRetries
    });
  }

  return openaiClient;
}

function logCoach(message) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[coach] ${message}`);
  }
}

module.exports = {
  generateCoachInsights,
  buildLocalCoachResponse,
  normalizeProviderError
};
