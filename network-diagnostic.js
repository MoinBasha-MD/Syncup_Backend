#!/usr/bin/env node

const { exec } = require('child_process');
const http = require('http');
const util = require('util');

const execAsync = util.promisify(exec);

async function runDiagnostic() {
  console.log('🔍 Network Diagnostic Tool');
  console.log('==========================');
  
  try {
    // Get network information
    console.log('\n📡 Network Configuration:');
    const { stdout: ipInfo } = await execAsync('ip addr show');
    const ipMatches = ipInfo.match(/inet (\d+\.\d+\.\d+\.\d+\/\d+)/g);
    if (ipMatches) {
      ipMatches.forEach(match => {
        console.log(`   ${match}`);
      });
    }
    
    // Get default route
    console.log('\n🛣️  Default Route:');
    const { stdout: routeInfo } = await execAsync('ip route show default');
    console.log(`   ${routeInfo.trim()}`);
    
    // Check if server is listening
    console.log('\n👂 Server Listening Status:');
    const { stdout: portInfo } = await execAsync('netstat -tlnp | grep :5000');
    console.log(`   ${portInfo.trim()}`);
    
    // Test connectivity to various addresses
    console.log('\n🔗 Connectivity Tests:');
    const testAddresses = [
      'localhost',
      '127.0.0.1',
      '192.168.0.115',
      '0.0.0.0'
    ];
    
    for (const addr of testAddresses) {
      try {
        await testHttp(addr, 5000);
        console.log(`   ✅ ${addr}:5000 - OK`);
      } catch (error) {
        console.log(`   ❌ ${addr}:5000 - ${error.message}`);
      }
    }
    
    // Network interface details
    console.log('\n🔍 Network Interface Details:');
    const { stdout: ifconfig } = await execAsync('ip addr show wlo1');
    console.log(ifconfig);
    
    // ARP table (shows connected devices)
    console.log('\n👥 Connected Devices (ARP Table):');
    try {
      const { stdout: arpInfo } = await execAsync('arp -a');
      console.log(arpInfo);
    } catch (error) {
      console.log('   Could not retrieve ARP table');
    }
    
    // Firewall status
    console.log('\n🛡️  Firewall Status:');
    try {
      const { stdout: firewallInfo } = await execAsync('sudo ufw status');
      console.log(firewallInfo);
    } catch (error) {
      console.log('   Could not check firewall status');
    }
    
  } catch (error) {
    console.error('Error running diagnostic:', error.message);
  }
}

function testHttp(host, port) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: port,
      path: '/health',
      method: 'GET',
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      resolve(res.statusCode);
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });

    req.end();
  });
}

runDiagnostic();
