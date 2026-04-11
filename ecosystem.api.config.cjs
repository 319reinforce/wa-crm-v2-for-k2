const NODE_INTERPRETER = process.env.WA_NODE_BINARY || '/Users/depp/.nvm/versions/node/v20.20.2/bin/node';

module.exports = {
  apps: [
    {
      name: 'wa-crm-api',
      cwd: '/Users/depp/wa-bot/wa-crm-v2',
      script: 'server/index.cjs',
      interpreter: NODE_INTERPRETER,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      min_uptime: '10s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 200,
      out_file: '/tmp/wa-crm-api.log',
      error_file: '/tmp/wa-crm-api.err.log',
      time: true,
      merge_logs: true,
      env: {
        PORT: '3000',
        DISABLE_WA_SERVICE: 'true',
        DISABLE_WA_WORKER: 'true',
      },
    },
  ],
};
