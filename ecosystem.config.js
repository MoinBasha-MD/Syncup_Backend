module.exports = {
  apps: [
    {
      name: 'server',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      // Increase Node.js heap to 2GB to prevent OOM crashes
      node_args: '--max-old-space-size=2048',
      env: {
        NODE_ENV: 'production',
      },
      // Restart if memory exceeds 1.5GB (safety net)
      max_memory_restart: '1500M',
      // Restart policy
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      // Logging
      out_file: '/root/.pm2/logs/server-out.log',
      error_file: '/root/.pm2/logs/server-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    }
  ]
};
