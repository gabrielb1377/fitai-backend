const cors = require("cors");

const allowedLocalOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedLocalOriginPattern.test(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-FitIA-Client-Id"],
  optionsSuccessStatus: 204
};

const corsMiddleware = cors(corsOptions);

module.exports = {
  corsMiddleware,
  corsOptions
};
