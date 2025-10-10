#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║              🔍 COMPREHENSIVE PHASE 1-2 BUG CHECK            ║
║                                                              ║
║  Checking all components from Phase 1 to Phase 2 for bugs,  ║
║  missing dependencies, integration issues, and potential     ║
║  runtime errors.                                             ║
╚══════════════════════════════════════════════════════════════╝
`);

let totalIssues = 0;
let criticalIssues = 0;
let warningIssues = 0;

// Helper function to check if file exists
const fileExists = (filePath) => fs.existsSync(path.join(__dirname, '..', filePath));

// Helper function to read file content
const readFile = (filePath) => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', filePath), 'utf8');
  } catch (error) {
    return null;
  }
};

// Helper function to log issues
const logIssue = (type, category, description, severity = 'warning') => {
  const icon = severity === 'critical' ? '🚨' : severity === 'error' ? '❌' : '⚠️';
  console.log(`${icon} [${category.toUpperCase()}] ${description}`);
  
  totalIssues++;
  if (severity === 'critical') criticalIssues++;
  else if (severity === 'warning') warningIssues++;
};

console.log('\n📋 PHASE 1 COMPONENTS CHECK...\n');

// 1. Check Phase 1 Models
console.log('🗄️  CHECKING PHASE 1 MODELS...');
const phase1Models = [
  'models/aiInstanceModel.js',
  'models/aiMessageQueueModel.js', 
  'models/groupAiNetworkModel.js'
];

phase1Models.forEach(model => {
  if (!fileExists(model)) {
    logIssue('missing', 'model', `${model} is missing`, 'critical');
  } else {
    const content = readFile(model);
    if (content) {
      // Check for common issues
      if (!content.includes('mongoose.model')) {
        logIssue('structure', 'model', `${model} missing mongoose.model export`, 'error');
      }
      if (!content.includes('timestamps: true')) {
        logIssue('structure', 'model', `${model} missing timestamps option`, 'warning');
      }
      if (!content.includes('index')) {
        logIssue('performance', 'model', `${model} may be missing database indexes`, 'warning');
      }
    }
  }
});

// 2. Check Phase 1 Services
console.log('\n🔧 CHECKING PHASE 1 SERVICES...');
const phase1Services = [
  'services/aiRouterService.js',
  'services/aiRegistryService.js',
  'services/aiMessageQueueService.js'
];

phase1Services.forEach(service => {
  if (!fileExists(service)) {
    logIssue('missing', 'service', `${service} is missing`, 'critical');
  } else {
    const content = readFile(service);
    if (content) {
      // Check for common service issues
      if (!content.includes('class ')) {
        logIssue('structure', 'service', `${service} should use class structure`, 'warning');
      }
      if (!content.includes('try {') || !content.includes('catch')) {
        logIssue('error-handling', 'service', `${service} missing proper error handling`, 'error');
      }
      if (!content.includes('logger') && !content.includes('console.log')) {
        logIssue('logging', 'service', `${service} missing logging`, 'warning');
      }
    }
  }
});

// 3. Check Phase 1 Controllers
console.log('\n🎮 CHECKING PHASE 1 CONTROLLERS...');
const phase1Controllers = [
  'controllers/aiInstanceController.js',
  'controllers/aiCommunicationController.js'
];

phase1Controllers.forEach(controller => {
  if (!fileExists(controller)) {
    logIssue('missing', 'controller', `${controller} is missing`, 'critical');
  } else {
    const content = readFile(controller);
    if (content) {
      // Check for controller-specific issues
      if (!content.includes('static async')) {
        logIssue('structure', 'controller', `${controller} should use static async methods`, 'warning');
      }
      if (!content.includes('res.status')) {
        logIssue('response', 'controller', `${controller} missing proper HTTP status codes`, 'error');
      }
      if (!content.includes('try {') || !content.includes('catch')) {
        logIssue('error-handling', 'controller', `${controller} missing error handling`, 'error');
      }
    }
  }
});

// 4. Check Phase 1 Routes
console.log('\n🛣️  CHECKING PHASE 1 ROUTES...');
const phase1Routes = [
  'routes/aiInstanceRoutes.js',
  'routes/aiCommunicationRoutes.js'
];

phase1Routes.forEach(route => {
  if (!fileExists(route)) {
    logIssue('missing', 'route', `${route} is missing`, 'critical');
  } else {
    const content = readFile(route);
    if (content) {
      // Check for route-specific issues
      if (!content.includes('router.')) {
        logIssue('structure', 'route', `${route} missing router definitions`, 'error');
      }
      if (!content.includes('module.exports')) {
        logIssue('export', 'route', `${route} missing module.exports`, 'critical');
      }
      if (!content.includes('authenticateAI') && !content.includes('protect')) {
        logIssue('security', 'route', `${route} missing authentication middleware`, 'error');
      }
    }
  }
});

console.log('\n📋 PHASE 2 COMPONENTS CHECK...\n');

// 5. Check Phase 2 Socket Integration
console.log('🔌 CHECKING PHASE 2 SOCKET INTEGRATION...');
const phase2SocketFiles = [
  'services/aiSocketService.js'
];

phase2SocketFiles.forEach(file => {
  if (!fileExists(file)) {
    logIssue('missing', 'socket', `${file} is missing`, 'critical');
  } else {
    const content = readFile(file);
    if (content) {
      if (!content.includes('socket.io')) {
        logIssue('dependency', 'socket', `${file} missing socket.io integration`, 'error');
      }
      if (!content.includes('authenticate')) {
        logIssue('security', 'socket', `${file} missing authentication`, 'error');
      }
      if (!content.includes('disconnect')) {
        logIssue('cleanup', 'socket', `${file} missing disconnect handling`, 'warning');
      }
    }
  }
});

// 6. Check Frontend Integration
console.log('\n📱 CHECKING FRONTEND INTEGRATION...');
const frontendFiles = [
  '../Syncup/src/services/aiCommunicationService.ts'
];

frontendFiles.forEach(file => {
  const fullPath = path.join(__dirname, file);
  if (!fs.existsSync(fullPath)) {
    logIssue('missing', 'frontend', `${file} is missing`, 'critical');
  } else {
    const content = fs.readFileSync(fullPath, 'utf8');
    if (content) {
      if (!content.includes('Socket')) {
        logIssue('integration', 'frontend', `${file} missing Socket.IO integration`, 'error');
      }
      if (!content.includes('async ')) {
        logIssue('async', 'frontend', `${file} should use async/await pattern`, 'warning');
      }
      if (!content.includes('try {')) {
        logIssue('error-handling', 'frontend', `${file} missing error handling`, 'error');
      }
    }
  }
});

// 7. Check Environment Variables
console.log('\n🔧 CHECKING ENVIRONMENT CONFIGURATION...');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  const requiredEnvVars = [
    'MONGO_URI',
    'JWT_SECRET',
    'AI_JWT_SECRET',
    'AI_NETWORK_ENABLED',
    'AI_MAX_CONCURRENT_CONVERSATIONS',
    'AI_MESSAGE_TIMEOUT'
  ];
  
  requiredEnvVars.forEach(envVar => {
    if (!envContent.includes(envVar)) {
      logIssue('config', 'environment', `Missing environment variable: ${envVar}`, 'error');
    }
  });
} else {
  logIssue('missing', 'environment', '.env file is missing', 'critical');
}

// 8. Check Package Dependencies
console.log('\n📦 CHECKING PACKAGE DEPENDENCIES...');
const packageJsonPath = path.join(__dirname, '..', 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  const requiredDeps = [
    'socket.io',
    'mongoose',
    'jsonwebtoken',
    'winston',
    'express'
  ];
  
  requiredDeps.forEach(dep => {
    if (!packageJson.dependencies[dep]) {
      logIssue('dependency', 'package', `Missing dependency: ${dep}`, 'error');
    }
  });
  
  // Check for potential version conflicts
  if (packageJson.dependencies['socket.io']) {
    const socketVersion = packageJson.dependencies['socket.io'];
    if (!socketVersion.includes('4.')) {
      logIssue('version', 'package', 'Socket.IO version should be 4.x for compatibility', 'warning');
    }
  }
} else {
  logIssue('missing', 'package', 'package.json is missing', 'critical');
}

// 9. Check Server Integration
console.log('\n🚀 CHECKING SERVER INTEGRATION...');
const serverPath = path.join(__dirname, '..', 'server.js');
if (fs.existsSync(serverPath)) {
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  
  const integrationChecks = [
    { check: 'aiInstanceRoutes', pattern: /aiInstanceRoutes/, description: 'AI Instance Routes integration' },
    { check: 'aiCommunicationRoutes', pattern: /aiCommunicationRoutes/, description: 'AI Communication Routes integration' },
    { check: 'aiSocketService', pattern: /aiSocketService|AISocketService/, description: 'AI Socket Service integration' },
    { check: 'loggerSetup', pattern: /loggerSetup/, description: 'Enhanced logging integration' }
  ];
  
  integrationChecks.forEach(check => {
    if (!check.pattern.test(serverContent)) {
      logIssue('integration', 'server', `Missing ${check.description}`, 'error');
    }
  });
} else {
  logIssue('missing', 'server', 'server.js is missing', 'critical');
}

// 10. Check for Common Code Issues
console.log('\n🔍 CHECKING FOR COMMON CODE ISSUES...');

// Check for circular dependencies
const checkCircularDeps = () => {
  const aiRouterContent = readFile('services/aiRouterService.js');
  const aiRegistryContent = readFile('services/aiRegistryService.js');
  
  if (aiRouterContent && aiRegistryContent) {
    if (aiRouterContent.includes('aiRegistryService') && aiRegistryContent.includes('aiRouterService')) {
      logIssue('circular', 'dependency', 'Potential circular dependency between aiRouterService and aiRegistryService', 'warning');
    }
  }
};

checkCircularDeps();

// Check for missing error handling patterns
const checkErrorHandling = () => {
  const criticalFiles = [
    'services/aiRouterService.js',
    'controllers/aiInstanceController.js',
    'controllers/aiCommunicationController.js'
  ];
  
  criticalFiles.forEach(file => {
    const content = readFile(file);
    if (content) {
      const tryBlocks = (content.match(/try\s*{/g) || []).length;
      const catchBlocks = (content.match(/catch\s*\(/g) || []).length;
      
      if (tryBlocks !== catchBlocks) {
        logIssue('error-handling', 'pattern', `${file} has unmatched try/catch blocks`, 'error');
      }
    }
  });
};

checkErrorHandling();

// 11. Check Database Connection Issues
console.log('\n🗄️  CHECKING DATABASE INTEGRATION...');
const modelsToCheck = [
  'models/aiInstanceModel.js',
  'models/aiMessageQueueModel.js',
  'models/groupAiNetworkModel.js'
];

modelsToCheck.forEach(model => {
  const content = readFile(model);
  if (content) {
    // Check for TTL indexes
    if (model.includes('Queue') && !content.includes('expireAfterSeconds')) {
      logIssue('database', 'ttl', `${model} missing TTL index for cleanup`, 'warning');
    }
    
    // Check for proper validation
    if (!content.includes('required: true') && !content.includes('validate:')) {
      logIssue('database', 'validation', `${model} missing field validation`, 'warning');
    }
  }
});

// 12. Performance and Security Checks
console.log('\n🔒 CHECKING SECURITY AND PERFORMANCE...');

// Check for hardcoded secrets
const filesToCheckForSecrets = [
  'services/aiRouterService.js',
  'middleware/aiAuthMiddleware.js',
  'controllers/aiInstanceController.js'
];

filesToCheckForSecrets.forEach(file => {
  const content = readFile(file);
  if (content) {
    if (content.includes('secret') && !content.includes('process.env')) {
      logIssue('security', 'hardcoded', `${file} may contain hardcoded secrets`, 'critical');
    }
    
    // Check for SQL injection patterns (even though we use MongoDB)
    if (content.includes('$where') || content.includes('eval')) {
      logIssue('security', 'injection', `${file} contains potentially unsafe query patterns`, 'error');
    }
  }
});

// Final Summary
console.log('\n' + '='.repeat(70));
console.log(`📊 COMPREHENSIVE CHECK SUMMARY:`);
console.log(`Total Issues Found: ${totalIssues}`);
console.log(`🚨 Critical Issues: ${criticalIssues}`);
console.log(`❌ Error Issues: ${warningIssues}`);
console.log(`⚠️  Warning Issues: ${totalIssues - criticalIssues - warningIssues}`);

if (totalIssues === 0) {
  console.log(`
🎉 EXCELLENT! NO ISSUES FOUND!

✅ Phase 1 components are solid
✅ Phase 2 integration is complete
✅ No critical bugs detected
✅ Security checks passed
✅ Performance optimizations in place

🚀 READY FOR PRODUCTION TESTING!
  `);
} else if (criticalIssues === 0) {
  console.log(`
✅ GOOD! NO CRITICAL ISSUES FOUND!

Phase 1-2 implementation is solid with only minor issues.
Address the warnings above for optimal performance.

🚀 READY FOR TESTING WITH MINOR FIXES!
  `);
} else {
  console.log(`
⚠️  ATTENTION REQUIRED!

${criticalIssues} critical issue${criticalIssues > 1 ? 's' : ''} must be fixed before testing.
Please address the critical issues marked with 🚨 above.

🔧 FIX CRITICAL ISSUES BEFORE PROCEEDING!
  `);
}

console.log('\n' + '='.repeat(70));

// Test Scenarios Status
console.log(`
🎯 TEST SCENARIOS STATUS:

☕ Coffee Meeting Scenario:
   ${fileExists('services/aiCommunicationService.ts') ? '✅' : '❌'} Frontend AI service ready
   ${fileExists('services/aiRouterService.js') ? '✅' : '❌'} Backend routing ready
   ${fileExists('controllers/aiCommunicationController.js') ? '✅' : '❌'} API endpoints ready

🎬 Group Movie Scenario:
   ${fileExists('models/groupAiNetworkModel.js') ? '✅' : '❌'} Group AI model ready
   ${fileExists('services/aiSocketService.js') ? '✅' : '❌'} Real-time broadcasting ready
   ${fileExists('services/aiRegistryService.js') ? '✅' : '❌'} Group discovery ready

🔄 Real-time Communication:
   ${fileExists('services/aiSocketService.js') ? '✅' : '❌'} Socket.IO integration ready
   ${fileExists('middleware/aiAuthMiddleware.js') ? '✅' : '❌'} AI authentication ready
   ${fileExists('services/aiMessageQueueService.js') ? '✅' : '❌'} Message queuing ready
`);

process.exit(criticalIssues > 0 ? 1 : 0);
