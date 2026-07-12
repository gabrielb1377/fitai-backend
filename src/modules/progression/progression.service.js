const { calculateExerciseProgression } = require("./progression.rules");

function generateExerciseProgression(input) {
  return calculateExerciseProgression(input);
}

module.exports = { generateExerciseProgression };
