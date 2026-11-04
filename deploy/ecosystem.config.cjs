const path = require("node:path");
module.exports = {
  apps: [
    {
      name: "cashpay-admin",
      cwd: path.resolve(__dirname, ".."),
      script: "server/index.js",
      node_args: "--env-file-if-exists=.env",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: { NODE_ENV: "production", HOST: "127.0.0.1", PORT: "3102" },
    },
  ],
};
