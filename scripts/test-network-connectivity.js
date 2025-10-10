#!/usr/bin/env node

const express = require('express');
const cors = require('cors');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                🌐 NETWORK CONNECTIVITY TEST                  ║
║                                                              ║
║  Testing if React Native can reach the backend server      ║
╚══════════════════════════════════════════════════════════════╝
`);

// Create a simple test server
const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  console.log('✅ Health check request received from:', req.ip);
  res.json({
    success: true,
    message: 'Backend server is reachable',
    timestamp: new Date().toISOString(),
    server: 'Syncup Backend'
  });
});

// Test endpoint for AI
app.get('/api/ai/test', (req, res) => {
  console.log('✅ AI test request received from:', req.ip);
  res.json({
    success: true,
    message: 'AI endpoints are reachable',
    timestamp: new Date().toISOString()
  });
});

// Start server on multiple ports to test
const ports = [5000, 3000, 8000];

ports.forEach(port => {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Test server running on:`);
    console.log(`   - http://localhost:${port}/api/health`);
    console.log(`   - http://192.168.1.11:${port}/api/health`);
    console.log(`   - http://0.0.0.0:${port}/api/health`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️  Port ${port} is already in use (probably your main server)`);
    } else {
      console.error(`❌ Error starting server on port ${port}:`, err.message);
    }
  });
});

console.log(`
📱 Test from your React Native app:
   1. Open Maya
   2. Check console logs for network connectivity test
   3. Look for "✅ Primary URL is reachable" or "❌ Primary URL failed"

🔧 If connection fails, try:
   1. Check if backend is running on port 5000
   2. Verify IP address 192.168.1.11 is correct
   3. Check firewall settings
   4. Try using localhost instead of IP
`);

// Keep the process running
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down test server...');
  process.exit(0);
});
