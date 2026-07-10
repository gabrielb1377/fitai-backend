const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseCoachResponse,
  normalizeCoachResponse,
  parseJson
} = require("../../src/modules/coach/coach.parser");
const { buildLocalCoachResponse } = require("../../src/modules/coach/coach.service");

test("parseCoachResponse parses OpenAI output_text JSON", () => {
  const parsed = parseCoachResponse({
    output_text: JSON.stringify({
      resumo: "Analise pronta.",
      geradoEm: "2026-07-09T12:00:00.000Z",
      insights: [
        {
          id: "insight-1",
          categoria: "progressao",
          prioridade: "alta",
          titulo: "Carga subindo",
          descricao: "Supino evoluiu nos registros recentes.",
          acao: "Mantenha tecnica antes de subir novamente.",
          exercicioId: "ex-1"
        }
      ]
    })
  });

  assert.equal(parsed.resumo, "Analise pronta.");
  assert.equal(parsed.insights.length, 1);
  assert.equal(parsed.insights[0].categoria, "progressao");
  assert.equal(parsed.insights[0].geradoEm, "2026-07-09T12:00:00.000Z");
});

test("normalizeCoachResponse limits descriptions and max insights", () => {
  const response = normalizeCoachResponse({
    resumo: "Resumo",
    geradoEm: "2026-07-09T12:00:00.000Z",
    insights: Array.from({ length: 12 }, (_, index) => ({
      id: `id-${index}`,
      categoria: "categoria-invalida",
      prioridade: "prioridade-invalida",
      titulo: `Insight ${index}`,
      descricao: "a".repeat(220),
      acao: "b".repeat(160),
      exercicioId: null
    }))
  });

  assert.equal(response.valid, true);
  assert.equal(response.data.insights.length, 8);
  assert.equal(response.data.insights[0].categoria, "sugestao");
  assert.equal(response.data.insights[0].prioridade, "media");
  assert.ok(response.data.insights[0].descricao.length <= 180);
  assert.ok(response.data.insights[0].acao.length <= 120);
});

test("buildLocalCoachResponse returns fallback insight with sparse data", () => {
  const result = buildLocalCoachResponse({
    source: "local",
    summary: {
      treinosConcluidos: 0,
      series: 0,
      metas: 0,
      corridas: 0
    },
    analysis: {},
    raw: {
      historicoTreinos: [],
      historicoExercicios: [],
      recordes: [],
      metas: [],
      corridas: []
    }
  }, {
    tipo: "geral",
    exercicioId: null,
    periodoDias: 30
  });

  assert.ok(result.geradoEm);
  assert.ok(result.insights.length > 0);
  assert.ok(result.insights.length <= 8);
});

test("parseJson accepts fenced JSON", () => {
  const parsed = parseJson("```json\n{\"resumo\":\"ok\",\"insights\":[],\"geradoEm\":\"2026-07-09T12:00:00.000Z\"}\n```");

  assert.equal(parsed.resumo, "ok");
});
