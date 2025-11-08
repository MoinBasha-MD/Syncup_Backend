/**
 * Agent Configuration
 * Centralized configuration for all monitoring agents
 * Adjust these values based on your system specifications
 */

module.exports = {
  // Memory Monitor Configuration
  memoryMonitor: {
    checkInterval: 10000, // Check every 10 seconds
    alertThreshold: 0.95, // Alert at 95% memory usage
    criticalThreshold: 0.97, // Critical at 97%
    highThreshold: 0.90, // High at 90%
    moderateThreshold: 0.75, // Moderate at 75%
    leakDetectionIncrease: 10, // % increase to detect leak
    reportInterval: 120000 // Report every 2 minutes
  },

  // Performance Analyzer Configuration
  performanceAnalyzer: {
    checkInterval: 15000, // Check every 15 seconds
    cpuAlertThreshold: 90, // Alert at 90% CPU
    cpuCriticalThreshold: 95, // Critical at 95% CPU
    cpuHighThreshold: 80, // High at 80% CPU
    cpuModerateThreshold: 60, // Moderate at 60% CPU
    reportInterval: 180000 // Report every 3 minutes
  },

  // Health Check Configuration
  healthCheck: {
    checkInterval: 30000, // Check every 30 seconds
    maxConsecutiveFailures: 3, // Max failures before alert
    serverTimeout: 5000, // Server health check timeout (ms)
    databaseTimeout: 5000, // Database health check timeout (ms)
    reportInterval: 300000 // Report every 5 minutes
  },

  // Log Monitor Configuration
  logMonitor: {
    reportInterval: 60000, // Report every minute
    pollInterval: 5000, // Poll log files every 5 seconds
    maxLogLines: 50, // Max lines to show in reports
    patterns: {
      error: /error|exception|failed|crash/i,
      warning: /warning|warn|deprecated/i,
      security: /unauthorized|forbidden|authentication failed|invalid token/i,
      performance: /timeout|slow query|high memory|cpu spike/i,
      pii: /ENC\[|HASH\[|password|token|secret/i
    }
  },

  // System Specifications (for reference)
  systemSpecs: {
    ram: '16GB', // Your system RAM
    storage: '50GB SSD', // Your storage
    cpu: '8 cores', // Your CPU cores
    notes: 'Adjust thresholds based on your actual system specs'
  },

  // Alert Configuration
  alerts: {
    enableConsoleAlerts: true,
    enableFileAlerts: true,
    enableEmailAlerts: false, // Set to true and configure SMTP
    enableSMSAlerts: false // Set to true and configure SMS service
  },

  // Logging Configuration
  logging: {
    enableVerbose: false, // Detailed logging
    enableDebug: false, // Debug mode
    logToFile: true, // Save agent logs to files
    logDirectory: './logs/agents'
  }
};
