const prisma = require("../../config/prisma");

const FEATURED_SLUGS = new Set([
  "hipertrofia-essencial-abc",
  "upper-lower-4-dias",
  "casa-sem-equipamentos",
  "calistenia-fundamentos"
]);

const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const EXERCISE_LIBRARY = {
  push: [
    ["Supino reto com barra", "Peito", ["Peito", "Tríceps"], ["barra", "banco"]],
    ["Supino inclinado com halteres", "Peito", ["Peito", "Ombros"], ["halteres", "banco"]],
    ["Crucifixo no cabo", "Peito", ["Peito"], ["cabo"]],
    ["Tríceps na polia", "Tríceps", ["Tríceps"], ["cabo"]]
  ],
  pull: [
    ["Puxada frontal", "Costas", ["Costas", "Bíceps"], ["máquina"]],
    ["Remada baixa", "Costas", ["Costas", "Bíceps"], ["cabo"]],
    ["Remada unilateral com halter", "Costas", ["Costas"], ["halteres", "banco"]],
    ["Rosca direta", "Bíceps", ["Bíceps"], ["barra"]]
  ],
  legs: [
    ["Agachamento livre", "Pernas", ["Quadríceps", "Glúteos"], ["barra"]],
    ["Leg press", "Pernas", ["Quadríceps", "Glúteos"], ["máquina"]],
    ["Mesa flexora", "Pernas", ["Posteriores"], ["máquina"]],
    ["Panturrilha em pé", "Pernas", ["Panturrilhas"], ["máquina"]]
  ],
  upper: [
    ["Supino reto com halteres", "Peito", ["Peito", "Tríceps"], ["halteres", "banco"]],
    ["Puxada frontal", "Costas", ["Costas", "Bíceps"], ["máquina"]],
    ["Desenvolvimento com halteres", "Ombros", ["Ombros", "Tríceps"], ["halteres", "banco"]],
    ["Rosca alternada", "Bíceps", ["Bíceps"], ["halteres"]]
  ],
  lower: [
    ["Agachamento goblet", "Pernas", ["Quadríceps", "Glúteos"], ["halteres"]],
    ["Levantamento terra romeno", "Pernas", ["Posteriores", "Glúteos"], ["barra"]],
    ["Cadeira extensora", "Pernas", ["Quadríceps"], ["máquina"]],
    ["Prancha", "Core", ["Abdômen"], ["peso corporal"]]
  ],
  full: [
    ["Agachamento goblet", "Pernas", ["Quadríceps", "Glúteos"], ["halteres"]],
    ["Supino reto com halteres", "Peito", ["Peito", "Tríceps"], ["halteres", "banco"]],
    ["Remada unilateral com halter", "Costas", ["Costas", "Bíceps"], ["halteres", "banco"]],
    ["Prancha", "Core", ["Abdômen"], ["peso corporal"]]
  ],
  power: [
    ["Agachamento livre", "Powerlifting", ["Quadríceps", "Glúteos"], ["barra", "rack"]],
    ["Supino reto com barra", "Powerlifting", ["Peito", "Tríceps"], ["barra", "banco"]],
    ["Levantamento terra", "Powerlifting", ["Costas", "Posteriores", "Glúteos"], ["barra"]],
    ["Remada curvada", "Costas", ["Costas", "Bíceps"], ["barra"]]
  ],
  casa: [
    ["Agachamento com peso corporal", "Pernas", ["Quadríceps", "Glúteos"], ["peso corporal"]],
    ["Flexão de braços", "Peito", ["Peito", "Tríceps"], ["peso corporal"]],
    ["Remada com mochila", "Costas", ["Costas", "Bíceps"], ["mochila"]],
    ["Prancha", "Core", ["Abdômen"], ["peso corporal"]]
  ],
  calistenia: [
    ["Barra fixa assistida", "Costas", ["Costas", "Bíceps"], ["barra fixa"]],
    ["Flexão de braços", "Peito", ["Peito", "Tríceps"], ["peso corporal"]],
    ["Afundo alternado", "Pernas", ["Quadríceps", "Glúteos"], ["peso corporal"]],
    ["Elevação de pernas", "Core", ["Abdômen"], ["peso corporal"]]
  ]
};

function day(name, title, muscleGroup, key) {
  return { name, title, muscleGroup, key };
}

function plan(slug, name, description, category, level, goal, split, daysPerWeek, estimatedMinutes, prescription, days) {
  return {
    slug,
    name,
    description,
    coverImage: `/images/ready-plans/${slug}.jpg`,
    category,
    level,
    goal,
    split,
    daysPerWeek,
    estimatedMinutes,
    prescription,
    days
  };
}

const READY_PLANS = [
  plan("hipertrofia-essencial-abc", "Hipertrofia Essencial ABC", "Volume equilibrado para desenvolver massa muscular em tres dias.", "Hipertrofia", "Intermediário", "Hipertrofia", "ABC", 3, 60, { sets: 4, reps: "8-12", rest: 90 }, [day("Dia A", "Peito + Tríceps", "Peito + Tríceps", "push"), day("Dia B", "Costas + Bíceps", "Costas + Bíceps", "pull"), day("Dia C", "Pernas + Core", "Pernas + Core", "legs")]),
  plan("emagrecimento-full-body", "Full Body Metabólico", "Treino de corpo inteiro com descansos curtos para foco em condicionamento.", "Emagrecimento", "Iniciante", "Emagrecimento", "Full Body", 3, 45, { sets: 3, reps: "12-15", rest: 45 }, [day("Dia A", "Corpo Inteiro A", "Corpo Inteiro", "full"), day("Dia B", "Corpo Inteiro B", "Corpo Inteiro", "full"), day("Dia C", "Corpo Inteiro C", "Corpo Inteiro", "full")]),
  plan("forca-fundamental", "Força Fundamental", "Base de força com movimentos compostos e progressão controlada.", "Força", "Intermediário", "Força", "Full Body", 3, 70, { sets: 5, reps: "4-6", rest: 150 }, [day("Dia A", "Agachamento + Empurrar", "Pernas + Peito", "power"), day("Dia B", "Puxar + Posterior", "Costas + Posteriores", "power"), day("Dia C", "Força Geral", "Corpo Inteiro", "power")]),
  plan("powerlifting-base", "Powerlifting Base", "Estrutura para evoluir agachamento, supino e levantamento terra.", "Powerlifting", "Avançado", "Powerlifting", "SBD", 3, 90, { sets: 5, reps: "3-5", rest: 180 }, [day("Dia A", "Agachamento", "Pernas", "power"), day("Dia B", "Supino", "Peito + Tríceps", "power"), day("Dia C", "Terra", "Costas + Posteriores", "power")]),
  plan("upper-lower-4-dias", "Upper/Lower 4 Dias", "Divisão equilibrada para treinar membros superiores e inferiores duas vezes por semana.", "Upper/Lower", "Intermediário", "Hipertrofia", "Upper/Lower", 4, 60, { sets: 4, reps: "8-12", rest: 90 }, [day("Dia A", "Upper 1", "Membros Superiores", "upper"), day("Dia B", "Lower 1", "Membros Inferiores", "lower"), day("Dia C", "Upper 2", "Membros Superiores", "upper"), day("Dia D", "Lower 2", "Membros Inferiores", "lower")]),
  plan("abc-classico", "ABC Clássico", "Rotina direta para academia com divisão muscular tradicional.", "ABC", "Iniciante", "Hipertrofia", "ABC", 3, 55, { sets: 3, reps: "10-12", rest: 75 }, [day("Dia A", "Peito + Tríceps", "Peito + Tríceps", "push"), day("Dia B", "Costas + Bíceps", "Costas + Bíceps", "pull"), day("Dia C", "Pernas", "Pernas", "legs")]),
  plan("abcd-hipertrofia", "ABCD Hipertrofia", "Mais volume por grupo muscular para praticantes com quatro dias disponíveis.", "ABCD", "Intermediário", "Hipertrofia", "ABCD", 4, 65, { sets: 4, reps: "8-12", rest: 90 }, [day("Dia A", "Peito", "Peito + Tríceps", "push"), day("Dia B", "Costas", "Costas + Bíceps", "pull"), day("Dia C", "Pernas", "Pernas", "legs"), day("Dia D", "Ombros + Braços", "Ombros + Braços", "upper")]),
  plan("abcde-avancado", "ABCDE Avançado", "Um foco principal por dia para maior volume e recuperação local.", "ABCDE", "Avançado", "Hipertrofia", "ABCDE", 5, 70, { sets: 4, reps: "8-10", rest: 90 }, [day("Dia A", "Peito", "Peito", "push"), day("Dia B", "Costas", "Costas", "pull"), day("Dia C", "Pernas", "Pernas", "legs"), day("Dia D", "Ombros", "Ombros", "upper"), day("Dia E", "Braços + Core", "Braços + Core", "upper")]),
  plan("ppl-6-dias", "PPL 6 Dias", "Push, pull e legs repetidos para alta frequência semanal.", "PPL", "Avançado", "Hipertrofia", "PPL", 6, 60, { sets: 4, reps: "8-12", rest: 75 }, [day("Dia A", "Push 1", "Peito + Ombros + Tríceps", "push"), day("Dia B", "Pull 1", "Costas + Bíceps", "pull"), day("Dia C", "Legs 1", "Pernas", "legs"), day("Dia D", "Push 2", "Peito + Ombros + Tríceps", "push"), day("Dia E", "Pull 2", "Costas + Bíceps", "pull"), day("Dia F", "Legs 2", "Pernas", "legs")]),
  plan("full-body-iniciante", "Full Body Iniciante", "Plano simples para criar consistência com os movimentos fundamentais.", "Full Body", "Iniciante", "Condicionamento", "Full Body", 3, 45, { sets: 3, reps: "10-12", rest: 60 }, [day("Dia A", "Corpo Inteiro A", "Corpo Inteiro", "full"), day("Dia B", "Corpo Inteiro B", "Corpo Inteiro", "full"), day("Dia C", "Corpo Inteiro C", "Corpo Inteiro", "full")]),
  plan("casa-sem-equipamentos", "Treino em Casa", "Rotina prática para manter a atividade com o mínimo de equipamentos.", "Casa", "Iniciante", "Condicionamento", "Full Body", 3, 35, { sets: 3, reps: "12-15", rest: 45 }, [day("Dia A", "Casa A", "Corpo Inteiro", "casa"), day("Dia B", "Casa B", "Corpo Inteiro", "casa"), day("Dia C", "Casa C", "Corpo Inteiro", "casa")]),
  plan("academia-primeiros-passos", "Academia Primeiros Passos", "Plano guiado para se adaptar aos equipamentos da academia com segurança.", "Academia", "Iniciante", "Hipertrofia", "Full Body", 3, 50, { sets: 3, reps: "10-12", rest: 75 }, [day("Dia A", "Academia A", "Corpo Inteiro", "full"), day("Dia B", "Academia B", "Corpo Inteiro", "full"), day("Dia C", "Academia C", "Corpo Inteiro", "full")]),
  plan("calistenia-fundamentos", "Calistenia Fundamentos", "Controle corporal e força relativa com exercícios progressivos.", "Calistenia", "Iniciante", "Força", "Full Body", 3, 45, { sets: 3, reps: "6-12", rest: 75 }, [day("Dia A", "Calistenia A", "Corpo Inteiro", "calistenia"), day("Dia B", "Calistenia B", "Corpo Inteiro", "calistenia"), day("Dia C", "Calistenia C", "Corpo Inteiro", "calistenia")])
];

function toPrismaPlan(planDefinition) {
  const { prescription, days, ...plan } = planDefinition;

  return {
    ...plan,
    featured: FEATURED_SLUGS.has(plan.slug),
    days: {
      create: days.map((dayDefinition, dayIndex) => ({
        name: dayDefinition.name,
        title: dayDefinition.title,
        weekday: WEEKDAYS[dayIndex] || null,
        muscleGroup: dayDefinition.muscleGroup,
        order: dayIndex + 1,
        exercises: {
          create: EXERCISE_LIBRARY[dayDefinition.key].map((exercise, exerciseIndex) => ({
            name: exercise[0],
            category: exercise[1],
            muscles: exercise[2],
            equipment: exercise[3],
            sets: prescription.sets,
            reps: prescription.reps,
            restSeconds: prescription.rest,
            order: exerciseIndex + 1
          }))
        }
      }))
    }
  };
}

async function seedReadyPlans(db = prisma) {
  for (const definition of READY_PLANS) {
    const data = toPrismaPlan(definition);
    const { days, ...planData } = data;

    await db.readyPlan.upsert({
      where: { slug: definition.slug },
      create: data,
      update: {
        ...planData,
        days: {
          deleteMany: {},
          create: days.create
        }
      }
    });
  }

  return { seeded: READY_PLANS.length };
}

async function main() {
  try {
    const result = await seedReadyPlans();
    console.info(`[ready-plans] ${result.seeded} planos prontos sincronizados.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[ready-plans] Falha ao executar seed.", error);
    process.exitCode = 1;
  });
}

module.exports = {
  READY_PLANS,
  seedReadyPlans,
  toPrismaPlan
};
