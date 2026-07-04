// pm2 process file (alternative to systemd).
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save && pm2 startup
//
// IMPORTANT: SQLite is single-writer. Keep instances: 1 / fork mode — never
// cluster mode, or concurrent writers will hit SQLITE_BUSY.
module.exports = {
  apps: [
    {
      name: "metrics-server",
      script: "server.js",
      interpreter: "bun",
      cwd: "/opt/metrics-server",
      instances: 1,
      exec_mode: "fork",
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        // Prefer an .env file next to the app; values here override it.
        // HOST: "127.0.0.1",
        // PORT: "3000",
      },
    },
  ],
};
