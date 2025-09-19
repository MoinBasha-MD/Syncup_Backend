#!/usr/bin/env node

/**
 * Server Performance Benchmarking Tool
 * Analyzes current server capacity and provides optimization recommendations
 */

const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

class PerformanceBenchmark {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:3000';
    this.concurrency = options.concurrency || 10;
    this.duration = options.duration || 30; // seconds
    this.warmupTime = options.warmupTime || 5; // seconds
    this.endpoints = options.endpoints || [
      { path: '/health', method: 'GET', name: 'Health Check' },
      { path: '/api/auth/check-user', method: 'POST', name: 'Auth Check', body: { userId: 'test123' } },
      { path: '/metrics', method: 'GET', name: 'Metrics' }
    ];
    
    this.results = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      requestsPerSecond: 0,
      errorRate: 0,
      responseTimePercentiles: {},
      statusCodes: {},
      errors: [],
      memoryUsage: [],
      cpuUsage: []
    };
    
    this.responseTimes = [];
    this.startTime = 0;
    this.endTime = 0;
  }

  // Make HTTP request
  async makeRequest(endpoint) {
    return new Promise((resolve) => {
      const startTime = performance.now();
      const url = new URL(endpoint.path, this.baseUrl);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;
      
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: endpoint.method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Performance-Benchmark/1.0'
        }
      };

      const req = httpModule.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          const endTime = performance.now();
          const responseTime = endTime - startTime;
          
          resolve({
            success: res.statusCode >= 200 && res.statusCode < 400,
            statusCode: res.statusCode,
            responseTime,
            dataSize: data.length,
            endpoint: endpoint.name
          });
        });
      });

      req.on('error', (error) => {
        const endTime = performance.now();
        const responseTime = endTime - startTime;
        
        resolve({
          success: false,
          statusCode: 0,
          responseTime,
          error: error.message,
          endpoint: endpoint.name
        });
      });

      // Add request body if provided
      if (endpoint.body) {
        req.write(JSON.stringify(endpoint.body));
      }

      req.setTimeout(10000); // 10 second timeout
      req.end();
    });
  }

  // Run concurrent requests
  async runConcurrentRequests(endpoint, count) {
    const promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(this.makeRequest(endpoint));
    }
    return Promise.all(promises);
  }

  // Calculate percentiles
  calculatePercentiles(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const percentiles = [50, 75, 90, 95, 99];
    const result = {};
    
    percentiles.forEach(p => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      result[`p${p}`] = sorted[Math.max(0, index)];
    });
    
    return result;
  }

  // Monitor system resources
  monitorResources() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    this.results.memoryUsage.push({
      timestamp: Date.now(),
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external
    });
    
    this.results.cpuUsage.push({
      timestamp: Date.now(),
      user: cpuUsage.user,
      system: cpuUsage.system
    });
  }

  // Run benchmark for a specific endpoint
  async benchmarkEndpoint(endpoint) {
    console.log(`\n🚀 Benchmarking: ${endpoint.name} (${endpoint.method} ${endpoint.path})`);
    console.log(`⏱️  Duration: ${this.duration}s, Concurrency: ${this.concurrency}`);
    
    const endpointResults = {
      endpoint: endpoint.name,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimes: [],
      statusCodes: {},
      errors: []
    };

    // Warmup phase
    console.log('🔥 Warming up...');
    await this.runConcurrentRequests(endpoint, this.concurrency);
    await new Promise(resolve => setTimeout(resolve, this.warmupTime * 1000));

    // Main benchmark
    console.log('📊 Running benchmark...');
    const startTime = performance.now();
    const endTime = startTime + (this.duration * 1000);
    
    const resourceMonitor = setInterval(() => this.monitorResources(), 1000);
    
    while (performance.now() < endTime) {
      const results = await this.runConcurrentRequests(endpoint, this.concurrency);
      
      results.forEach(result => {
        endpointResults.totalRequests++;
        endpointResults.responseTimes.push(result.responseTime);
        
        if (result.success) {
          endpointResults.successfulRequests++;
        } else {
          endpointResults.failedRequests++;
          if (result.error) {
            endpointResults.errors.push(result.error);
          }
        }
        
        const statusCode = result.statusCode || 'error';
        endpointResults.statusCodes[statusCode] = (endpointResults.statusCodes[statusCode] || 0) + 1;
      });
    }
    
    clearInterval(resourceMonitor);
    
    // Calculate statistics
    const actualDuration = (performance.now() - startTime) / 1000;
    const rps = endpointResults.totalRequests / actualDuration;
    const avgResponseTime = endpointResults.responseTimes.reduce((a, b) => a + b, 0) / endpointResults.responseTimes.length;
    const minResponseTime = Math.min(...endpointResults.responseTimes);
    const maxResponseTime = Math.max(...endpointResults.responseTimes);
    const errorRate = (endpointResults.failedRequests / endpointResults.totalRequests) * 100;
    const percentiles = this.calculatePercentiles(endpointResults.responseTimes);
    
    console.log(`\n📈 Results for ${endpoint.name}:`);
    console.log(`   Total Requests: ${endpointResults.totalRequests}`);
    console.log(`   Successful: ${endpointResults.successfulRequests}`);
    console.log(`   Failed: ${endpointResults.failedRequests}`);
    console.log(`   Requests/sec: ${rps.toFixed(2)}`);
    console.log(`   Avg Response Time: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`   Min Response Time: ${minResponseTime.toFixed(2)}ms`);
    console.log(`   Max Response Time: ${maxResponseTime.toFixed(2)}ms`);
    console.log(`   Error Rate: ${errorRate.toFixed(2)}%`);
    console.log(`   Percentiles: P50=${percentiles.p50.toFixed(2)}ms, P95=${percentiles.p95.toFixed(2)}ms, P99=${percentiles.p99.toFixed(2)}ms`);
    
    return {
      ...endpointResults,
      requestsPerSecond: rps,
      averageResponseTime: avgResponseTime,
      minResponseTime,
      maxResponseTime,
      errorRate,
      percentiles,
      duration: actualDuration
    };
  }

  // Run full benchmark suite
  async run() {
    console.log('🎯 Starting Performance Benchmark');
    console.log(`📍 Target: ${this.baseUrl}`);
    console.log(`⚙️  Configuration: ${this.concurrency} concurrent, ${this.duration}s duration\n`);
    
    const allResults = [];
    
    for (const endpoint of this.endpoints) {
      try {
        const result = await this.benchmarkEndpoint(endpoint);
        allResults.push(result);
        
        // Brief pause between endpoints
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`❌ Error benchmarking ${endpoint.name}:`, error.message);
      }
    }
    
    // Generate summary report
    this.generateReport(allResults);
    
    return allResults;
  }

  // Generate comprehensive report
  generateReport(results) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PERFORMANCE BENCHMARK REPORT');
    console.log('='.repeat(60));
    
    const totalRPS = results.reduce((sum, r) => sum + r.requestsPerSecond, 0);
    const avgResponseTime = results.reduce((sum, r) => sum + r.averageResponseTime, 0) / results.length;
    const totalRequests = results.reduce((sum, r) => sum + r.totalRequests, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.failedRequests, 0);
    const overallErrorRate = (totalErrors / totalRequests) * 100;
    
    console.log(`\n🎯 OVERALL PERFORMANCE:`);
    console.log(`   Total Requests Processed: ${totalRequests.toLocaleString()}`);
    console.log(`   Combined Requests/sec: ${totalRPS.toFixed(2)}`);
    console.log(`   Average Response Time: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`   Overall Error Rate: ${overallErrorRate.toFixed(2)}%`);
    
    console.log(`\n📋 ENDPOINT BREAKDOWN:`);
    results.forEach(result => {
      console.log(`   ${result.endpoint}:`);
      console.log(`     RPS: ${result.requestsPerSecond.toFixed(2)}`);
      console.log(`     Avg Response: ${result.averageResponseTime.toFixed(2)}ms`);
      console.log(`     P95 Response: ${result.percentiles.p95.toFixed(2)}ms`);
      console.log(`     Error Rate: ${result.errorRate.toFixed(2)}%`);
    });
    
    // Performance classification
    console.log(`\n🏆 PERFORMANCE CLASSIFICATION:`);
    if (totalRPS > 1000) {
      console.log(`   🟢 EXCELLENT (${totalRPS.toFixed(0)} RPS) - High-performance server`);
    } else if (totalRPS > 500) {
      console.log(`   🟡 GOOD (${totalRPS.toFixed(0)} RPS) - Solid performance`);
    } else if (totalRPS > 100) {
      console.log(`   🟠 MODERATE (${totalRPS.toFixed(0)} RPS) - Room for improvement`);
    } else {
      console.log(`   🔴 LOW (${totalRPS.toFixed(0)} RPS) - Needs optimization`);
    }
    
    // Recommendations
    console.log(`\n💡 OPTIMIZATION RECOMMENDATIONS:`);
    
    if (avgResponseTime > 100) {
      console.log(`   ⚠️  High average response time (${avgResponseTime.toFixed(2)}ms)`);
      console.log(`      - Consider database query optimization`);
      console.log(`      - Implement response caching`);
      console.log(`      - Add connection pooling`);
    }
    
    if (overallErrorRate > 1) {
      console.log(`   ⚠️  High error rate (${overallErrorRate.toFixed(2)}%)`);
      console.log(`      - Review error handling`);
      console.log(`      - Check resource limits`);
      console.log(`      - Monitor system resources`);
    }
    
    if (totalRPS < 500) {
      console.log(`   ⚠️  Low throughput (${totalRPS.toFixed(0)} RPS)`);
      console.log(`      - Enable response compression`);
      console.log(`      - Optimize middleware stack`);
      console.log(`      - Consider clustering`);
      console.log(`      - Implement caching strategies`);
    }
    
    // Save detailed report
    const reportData = {
      timestamp: new Date().toISOString(),
      configuration: {
        baseUrl: this.baseUrl,
        concurrency: this.concurrency,
        duration: this.duration
      },
      summary: {
        totalRequests,
        totalRPS,
        avgResponseTime,
        overallErrorRate
      },
      endpoints: results,
      systemResources: {
        memory: this.results.memoryUsage,
        cpu: this.results.cpuUsage
      }
    };
    
    const reportPath = path.join(__dirname, '..', 'logs', `performance-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    
    console.log('\n' + '='.repeat(60));
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];
    
    if (key === 'url') options.baseUrl = value;
    if (key === 'concurrency') options.concurrency = parseInt(value);
    if (key === 'duration') options.duration = parseInt(value);
  }
  
  const benchmark = new PerformanceBenchmark(options);
  
  benchmark.run().then(() => {
    console.log('\n✅ Benchmark completed successfully!');
    process.exit(0);
  }).catch(error => {
    console.error('\n❌ Benchmark failed:', error.message);
    process.exit(1);
  });
}

module.exports = PerformanceBenchmark;
