#!/usr/bin/env node

/**
 * Master Agent - Central Control System
 * Manages multiple sub-agents for backend operations
 * Provides interactive CLI for server management, monitoring, and diagnostics
 */

const readline = require('readline');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

class MasterAgent {
  constructor() {
    this.serverProcess = null;
    this.agents = {
      logMonitor: null,
      healthCheck: null,
      memoryMonitor: null,
      performanceAnalyzer: null
    };
    
    this.agentStatus = {
      logMonitor: 'stopped',
      healthCheck: 'stopped',
      memoryMonitor: 'stopped',
      performanceAnalyzer: 'stopped'
    };
    
    this.serverStatus = 'stopped';
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    this.logsDir = path.join(__dirname, '../logs');
    this.agentLogsDir = path.join(__dirname, '../logs/agents');
    
    // Create directories if they don't exist
    [this.logsDir, this.agentLogsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  // Display banner
  displayBanner() {
    console.clear();
    console.log(`${colors.cyan}${colors.bright}
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║              🤖 SYNCUP MASTER AGENT CONTROL CENTER             ║
║                                                                ║
║                    Backend Management System                   ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
${colors.reset}`);
  }

  // Display main menu
  displayMenu() {
    console.log(`\n${colors.bright}${colors.white}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
    console.log(`${colors.bright}SERVER CONTROL:${colors.reset}`);
    console.log(`  ${colors.green}1.${colors.reset} Start Server`);
    console.log(`  ${colors.red}2.${colors.reset} Stop Server`);
    console.log(`  ${colors.yellow}3.${colors.reset} Restart Server`);
    console.log(`  ${colors.cyan}4.${colors.reset} Server Status\n`);
    
    console.log(`${colors.bright}AGENT MANAGEMENT:${colors.reset}`);
    console.log(`  ${colors.green}5.${colors.reset} Start All Agents`);
    console.log(`  ${colors.red}6.${colors.reset} Stop All Agents`);
    console.log(`  ${colors.yellow}7.${colors.reset} Agent Status Report`);
    console.log(`  ${colors.magenta}8.${colors.reset} Start Individual Agent\n`);
    
    console.log(`${colors.bright}MONITORING & DIAGNOSTICS:${colors.reset}`);
    console.log(`  ${colors.cyan}9.${colors.reset} View Live Logs`);
    console.log(`  ${colors.blue}10.${colors.reset} System Health Report`);
    console.log(`  ${colors.magenta}11.${colors.reset} Memory Analysis`);
    console.log(`  ${colors.yellow}12.${colors.reset} Performance Metrics\n`);
    
    console.log(`${colors.bright}UTILITIES:${colors.reset}`);
    console.log(`  ${colors.green}13.${colors.reset} Clear Logs`);
    console.log(`  ${colors.cyan}14.${colors.reset} Backup Configuration`);
    console.log(`  ${colors.yellow}15.${colors.reset} View Agent Logs\n`);
    
    console.log(`  ${colors.red}0.${colors.reset} Exit Master Agent\n`);
    console.log(`${colors.white}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
  }

  // Display current status
  displayStatus() {
    console.log(`\n${colors.bright}${colors.cyan}═══ CURRENT STATUS ═══${colors.reset}`);
    console.log(`Server: ${this.getStatusColor(this.serverStatus)}${this.serverStatus.toUpperCase()}${colors.reset}`);
    console.log(`\nAgents:`);
    Object.entries(this.agentStatus).forEach(([agent, status]) => {
      console.log(`  ${agent}: ${this.getStatusColor(status)}${status.toUpperCase()}${colors.reset}`);
    });
    console.log(`${colors.cyan}═══════════════════════${colors.reset}\n`);
  }

  // Get color based on status
  getStatusColor(status) {
    switch(status) {
      case 'running': return colors.green;
      case 'stopped': return colors.red;
      case 'error': return colors.red + colors.bright;
      default: return colors.yellow;
    }
  }

  // Start server
  async startServer() {
    if (this.serverProcess) {
      console.log(`${colors.yellow}⚠️  Server is already running${colors.reset}`);
      return;
    }

    console.log(`${colors.cyan}🚀 Starting Syncup Server...${colors.reset}`);
    
    const serverPath = path.join(__dirname, '../server.js');
    this.serverProcess = spawn('node', [serverPath], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' }
    });

    this.serverStatus = 'running';

    this.serverProcess.stdout.on('data', (data) => {
      console.log(`${colors.green}[SERVER]${colors.reset} ${data.toString().trim()}`);
    });

    this.serverProcess.stderr.on('data', (data) => {
      console.log(`${colors.red}[SERVER ERROR]${colors.reset} ${data.toString().trim()}`);
    });

    this.serverProcess.on('close', (code) => {
      console.log(`${colors.yellow}⚠️  Server stopped with code ${code}${colors.reset}`);
      this.serverStatus = 'stopped';
      this.serverProcess = null;
    });

    console.log(`${colors.green}✅ Server started successfully${colors.reset}`);
  }

  // Stop server
  async stopServer() {
    if (!this.serverProcess) {
      console.log(`${colors.yellow}⚠️  Server is not running${colors.reset}`);
      return;
    }

    console.log(`${colors.cyan}🛑 Stopping server...${colors.reset}`);
    this.serverProcess.kill('SIGTERM');
    
    // Wait for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (this.serverProcess) {
      this.serverProcess.kill('SIGKILL');
    }
    
    this.serverProcess = null;
    this.serverStatus = 'stopped';
    console.log(`${colors.green}✅ Server stopped${colors.reset}`);
  }

  // Restart server
  async restartServer() {
    console.log(`${colors.cyan}🔄 Restarting server...${colors.reset}`);
    await this.stopServer();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.startServer();
  }

  // Start agent
  startAgent(agentName) {
    if (this.agents[agentName]) {
      console.log(`${colors.yellow}⚠️  ${agentName} is already running${colors.reset}`);
      return;
    }

    const agentPath = path.join(__dirname, `${agentName}Agent.js`);
    
    if (!fs.existsSync(agentPath)) {
      console.log(`${colors.red}❌ Agent file not found: ${agentPath}${colors.reset}`);
      return;
    }

    console.log(`${colors.cyan}🤖 Starting ${agentName}...${colors.reset}`);
    
    const agent = spawn('node', [agentPath], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.agents[agentName] = agent;
    this.agentStatus[agentName] = 'running';

    agent.stdout.on('data', (data) => {
      console.log(`${colors.magenta}[${agentName.toUpperCase()}]${colors.reset} ${data.toString().trim()}`);
    });

    agent.stderr.on('data', (data) => {
      console.log(`${colors.red}[${agentName.toUpperCase()} ERROR]${colors.reset} ${data.toString().trim()}`);
    });

    agent.on('close', (code) => {
      console.log(`${colors.yellow}⚠️  ${agentName} stopped with code ${code}${colors.reset}`);
      this.agentStatus[agentName] = 'stopped';
      this.agents[agentName] = null;
    });

    console.log(`${colors.green}✅ ${agentName} started${colors.reset}`);
  }

  // Stop agent
  stopAgent(agentName) {
    if (!this.agents[agentName]) {
      console.log(`${colors.yellow}⚠️  ${agentName} is not running${colors.reset}`);
      return;
    }

    console.log(`${colors.cyan}🛑 Stopping ${agentName}...${colors.reset}`);
    this.agents[agentName].kill('SIGTERM');
    this.agents[agentName] = null;
    this.agentStatus[agentName] = 'stopped';
    console.log(`${colors.green}✅ ${agentName} stopped${colors.reset}`);
  }

  // Start all agents
  startAllAgents() {
    console.log(`${colors.cyan}🤖 Starting all agents...${colors.reset}`);
    Object.keys(this.agents).forEach(agent => {
      if (fs.existsSync(path.join(__dirname, `${agent}Agent.js`))) {
        this.startAgent(agent);
      }
    });
  }

  // Stop all agents
  stopAllAgents() {
    console.log(`${colors.cyan}🛑 Stopping all agents...${colors.reset}`);
    Object.keys(this.agents).forEach(agent => {
      if (this.agents[agent]) {
        this.stopAgent(agent);
      }
    });
  }

  // System health report
  async systemHealthReport() {
    console.log(`\n${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}                  SYSTEM HEALTH REPORT                     ${colors.reset}`);
    console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}\n`);
    
    // System info
    console.log(`${colors.bright}System Information:${colors.reset}`);
    console.log(`  Platform: ${os.platform()}`);
    console.log(`  Architecture: ${os.arch()}`);
    console.log(`  Node Version: ${process.version}`);
    console.log(`  Uptime: ${Math.floor(os.uptime() / 3600)} hours\n`);
    
    // Memory info
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const usedMem = (totalMem - freeMem).toFixed(2);
    const memUsage = ((usedMem / totalMem) * 100).toFixed(2);
    
    console.log(`${colors.bright}Memory Status:${colors.reset}`);
    console.log(`  Total: ${totalMem} GB`);
    console.log(`  Used: ${usedMem} GB (${memUsage}%)`);
    console.log(`  Free: ${freeMem} GB\n`);
    
    // CPU info
    const cpus = os.cpus();
    console.log(`${colors.bright}CPU Information:${colors.reset}`);
    console.log(`  Cores: ${cpus.length}`);
    console.log(`  Model: ${cpus[0].model}\n`);
    
    // Server status
    console.log(`${colors.bright}Server Status:${colors.reset}`);
    console.log(`  Status: ${this.getStatusColor(this.serverStatus)}${this.serverStatus.toUpperCase()}${colors.reset}`);
    console.log(`  PID: ${this.serverProcess ? this.serverProcess.pid : 'N/A'}\n`);
    
    // Agent status
    console.log(`${colors.bright}Agent Status:${colors.reset}`);
    Object.entries(this.agentStatus).forEach(([agent, status]) => {
      const pid = this.agents[agent] ? this.agents[agent].pid : 'N/A';
      console.log(`  ${agent}: ${this.getStatusColor(status)}${status.toUpperCase()}${colors.reset} (PID: ${pid})`);
    });
    
    console.log(`\n${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}\n`);
  }

  // View logs
  viewLogs(logType = 'server') {
    const logFile = path.join(this.logsDir, `${logType}.log`);
    
    if (!fs.existsSync(logFile)) {
      console.log(`${colors.red}❌ Log file not found: ${logFile}${colors.reset}`);
      return;
    }

    console.log(`${colors.cyan}📋 Viewing ${logType} logs (last 50 lines)...${colors.reset}\n`);
    
    const logs = fs.readFileSync(logFile, 'utf8').split('\n').slice(-50).join('\n');
    console.log(logs);
    console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.yellow}💡 Tip: Use option 9 to view different log types${colors.reset}`);
    console.log(`${colors.green}Press Enter to return to main menu...${colors.reset}`);
  }

  // Clear logs
  clearLogs() {
    console.log(`${colors.cyan}🗑️  Clearing logs...${colors.reset}`);
    
    const logFiles = fs.readdirSync(this.logsDir).filter(f => f.endsWith('.log'));
    logFiles.forEach(file => {
      fs.writeFileSync(path.join(this.logsDir, file), '');
    });
    
    console.log(`${colors.green}✅ Cleared ${logFiles.length} log files${colors.reset}`);
  }

  // Main loop
  async run() {
    this.displayBanner();
    this.displayStatus();
    this.displayMenu();

    this.rl.question(`${colors.bright}${colors.cyan}Select an option: ${colors.reset}`, async (answer) => {
      console.log('');
      
      switch(answer.trim()) {
        case '1':
          await this.startServer();
          break;
        case '2':
          await this.stopServer();
          break;
        case '3':
          await this.restartServer();
          break;
        case '4':
          this.displayStatus();
          break;
        case '5':
          this.startAllAgents();
          break;
        case '6':
          this.stopAllAgents();
          break;
        case '7':
          this.displayStatus();
          break;
        case '8':
          this.rl.question('Enter agent name (logMonitor/healthCheck/memoryMonitor/performanceAnalyzer): ', (agentName) => {
            this.startAgent(agentName.trim());
            this.run();
          });
          return;
        case '9':
          this.rl.question('Log type (server/ai-communication/connections/database/errors): ', (logType) => {
            this.viewLogs(logType.trim());
            this.rl.question('', () => {
              this.run();
            });
          });
          return;
        case '10':
          await this.systemHealthReport();
          break;
        case '11':
          console.log(`${colors.yellow}Memory analysis agent starting...${colors.reset}`);
          this.startAgent('memoryMonitor');
          break;
        case '12':
          console.log(`${colors.yellow}Performance metrics agent starting...${colors.reset}`);
          this.startAgent('performanceAnalyzer');
          break;
        case '13':
          this.clearLogs();
          break;
        case '14':
          console.log(`${colors.yellow}Backup feature coming soon...${colors.reset}`);
          break;
        case '15':
          this.viewLogs('agents/master');
          this.rl.question('', () => {
            this.run();
          });
          return;
        case '0':
          await this.shutdown();
          return;
        default:
          console.log(`${colors.red}❌ Invalid option${colors.reset}`);
      }

      // Continue loop
      setTimeout(() => this.run(), 1000);
    });
  }

  // Shutdown
  async shutdown() {
    console.log(`\n${colors.cyan}🛑 Shutting down Master Agent...${colors.reset}`);
    
    await this.stopServer();
    this.stopAllAgents();
    
    this.rl.close();
    console.log(`${colors.green}✅ Master Agent shutdown complete${colors.reset}\n`);
    process.exit(0);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n\nReceived SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\nReceived SIGTERM, shutting down...');
  process.exit(0);
});

// Start Master Agent
const masterAgent = new MasterAgent();
masterAgent.run();
