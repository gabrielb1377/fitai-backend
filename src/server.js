const createApp = require("./app");
const env = require("./config/env");

const app = createApp();

if (require.main === module) {
  app.listen(env.port, () => {
    console.log(`FitIA backend running on port ${env.port}`);
  });
}

module.exports = app;
