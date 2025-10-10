// Simple test script to validate AI system setup
const path = require('path');

console.log('🧪 Testing AI System Setup...\n');

// Test 1: Check if all required files exist
const requiredFiles = [
  'models/aiInstanceModel.js',
  'models/aiMessageQueueModel.js', 
  'models/groupAiNetworkModel.js',
  'services/aiRouterService.js',
  'services/aiRegistryService.js',
  'services/aiMessageQueueService.js',
  'middleware/aiAuthMiddleware.js',
  'controllers/aiInstanceController.js',
  'controllers/aiCommunicationController.js',
  'routes/aiInstanceRoutes.js',
  'routes/aiCommunicationRoutes.js'
];

console.log('📁 Checking required files...');
const fs = require('fs');
let allFilesExist = true;

requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - MISSING`);
    allFilesExist = false;
  }
});

if (!allFilesExist) {
  console.log('\n❌ Some required files are missing!');
  process.exit(1);
}

// Test 2: Check if modules can be required without syntax errors
console.log('\n📦 Testing module imports...');
const modules = [
  { name: 'AIInstance Model', path: './models/aiInstanceModel.js' },
  { name: 'AIMessageQueue Model', path: './models/aiMessageQueueModel.js' },
  { name: 'GroupAINetwork Model', path: './models/groupAiNetworkModel.js' },
  { name: 'AIRouter Service', path: './services/aiRouterService.js' },
  { name: 'AIRegistry Service', path: './services/aiRegistryService.js' },
  { name: 'AIMessageQueue Service', path: './services/aiMessageQueueService.js' },
  { name: 'AIAuth Middleware', path: './middleware/aiAuthMiddleware.js' },
  { name: 'AIInstance Controller', path: './controllers/aiInstanceController.js' },
  { name: 'AICommunication Controller', path: './controllers/aiCommunicationController.js' }
];

let allModulesValid = true;

modules.forEach(module => {
  try {
    require(module.path);
    console.log(`✅ ${module.name}`);
  } catch (error) {
    console.log(`❌ ${module.name} - ERROR: ${error.message}`);
    allModulesValid = false;
  }
});

// Test 3: Check environment variables
console.log('\n🔧 Checking environment variables...');
require('dotenv').config();

const requiredEnvVars = [
  'MONGO_URI',
  'JWT_SECRET',
  'AI_JWT_SECRET',
  'AI_NETWORK_ENABLED'
];

let allEnvVarsSet = true;

requiredEnvVars.forEach(envVar => {
  if (process.env[envVar]) {
    console.log(`✅ ${envVar}`);
  } else {
    console.log(`❌ ${envVar} - NOT SET`);
    allEnvVarsSet = false;
  }
});

// Final result
console.log('\n🎯 Test Results:');
console.log(`Files: ${allFilesExist ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Modules: ${allModulesValid ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Environment: ${allEnvVarsSet ? '✅ PASS' : '❌ FAIL'}`);

if (allFilesExist && allModulesValid && allEnvVarsSet) {
  console.log('\n🎉 AI System setup is ready!');
  process.exit(0);
} else {
  console.log('\n❌ AI System setup has issues that need to be fixed.');
  process.exit(1);
}
