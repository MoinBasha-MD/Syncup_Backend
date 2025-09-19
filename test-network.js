#!/usr/bin/env node

const http = require('http');
const os = require('os');

// Get network interfaces
function getNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const results = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        results.push({
          name,
          address: iface.address,
          netmask: iface.netmask,
          broadcast: iface.broadcast
        });
      }
    }
  }
  
  return results;
}

// Test server connectivity
function testServerHealth(host, port) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: port,
      path: '/health',
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: data
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function runNetworkTest() {
  console.log('🔍 Network Connectivity Test');
  console.log('============================');
  
  // Show network interfaces
  console.log('\n📡 Network Interfaces:');
  const interfaces = getNetworkInterfaces();
  interfaces.forEach((iface, index) => {
    console.log(`${index + 1}. ${iface.name}: ${iface.address} (${iface.netmask})`);
  });
  
  // Test localhost
  console.log('\n🏠 Testing localhost:5000...');
  try {
    const result = await testServerHealth('localhost', 5000);
    console.log('✅ Localhost: SUCCESS');
    console.log(`   Status: ${result.status}`);
  } catch (error) {
    console.log('❌ Localhost: FAILED');
    console.log(`   Error: ${error.message}`);
  }
  
  // Test each network interface
  for (const iface of interfaces) {
    console.log(`\n🌐 Testing ${iface.address}:5000...`);
    try {
      const result = await testServerHealth(iface.address, 5000);
      console.log(`✅ ${iface.address}: SUCCESS`);
      console.log(`   Status: ${result.status}`);
    } catch (error) {
      console.log(`❌ ${iface.address}: FAILED`);
      console.log(`   Error: ${error.message}`);
    }
  }
  
  console.log('\n📋 Troubleshooting Tips:');
  console.log('1. Run this script from your CLIENT device to test connectivity');
  console.log('2. Ensure both devices are on the same network');
  console.log('3. Check router settings for AP isolation');
  console.log('4. Try disabling any VPN or proxy on client device');
  console.log('5. For React Native: ensure app has local network permissions');
  
  console.log('\n🔧 From your client device, run:');
  console.log(`   curl http://${interfaces[0]?.address || '192.168.0.115'}:5000/health`);
  console.log(`   ping ${interfaces[0]?.address || '192.168.0.115'}`);
}

runNetworkTest().catch(console.error);
