#!/usr/bin/env node

/**
 * Backend Cleanup and Optimization Script
 * This script identifies and helps remove unnecessary code, optimizes imports,
 * and provides recommendations for further improvements.
 */

const fs = require('fs');
const path = require('path');

class BackendCleanup {
  constructor() {
    this.issues = [];
    this.suggestions = [];
    this.stats = {
      filesScanned: 0,
      issuesFound: 0,
      suggestionsGenerated: 0
    };
  }

  // Scan for common issues
  scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      this.stats.filesScanned++;
      
      // Check for console.log statements (except in specific files)
      if (!filePath.includes('logger') && !filePath.includes('winston')) {
        lines.forEach((line, index) => {
          if (line.includes('console.log') || line.includes('console.error')) {
            this.issues.push({
              type: 'logging',
              file: filePath,
              line: index + 1,
              content: line.trim(),
              severity: 'medium',
              suggestion: 'Replace console.log with proper Winston logging'
            });
          }
        });
      }

      // Check for TODO/FIXME comments
      lines.forEach((line, index) => {
        if (line.includes('TODO') || line.includes('FIXME') || line.includes('HACK')) {
          this.issues.push({
            type: 'todo',
            file: filePath,
            line: index + 1,
            content: line.trim(),
            severity: 'low',
            suggestion: 'Address TODO/FIXME comments'
          });
        }
      });

      // Check for unused imports (basic check)
      const importRegex = /^const\s+(\{[^}]+\}|\w+)\s*=\s*require\(['"][^'"]+['"]\);?$/gm;
      const imports = [];
      let match;
      
      while ((match = importRegex.exec(content)) !== null) {
        const importName = match[1].replace(/[{}]/g, '').split(',').map(s => s.trim());
        importName.forEach(name => {
          if (name && !content.includes(name.split(':')[0].trim()) || 
              content.split(match[0]).join('').indexOf(name.split(':')[0].trim()) === -1) {
            // This is a basic check - might have false positives
            this.suggestions.push({
              type: 'unused_import',
              file: filePath,
              content: match[0],
              suggestion: `Potentially unused import: ${name}`
            });
          }
        });
      }

      // Check for hardcoded values
      const hardcodedPatterns = [
        /localhost:\d+/g,
        /127\.0\.0\.1:\d+/g,
        /mongodb:\/\/[^'"\s]+/g
      ];

      hardcodedPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          this.issues.push({
            type: 'hardcoded',
            file: filePath,
            content: match[0],
            severity: 'high',
            suggestion: 'Move hardcoded values to environment variables'
          });
        }
      });

      // Check for missing error handling
      if (content.includes('async ') && !content.includes('try') && !content.includes('catch')) {
        this.issues.push({
          type: 'error_handling',
          file: filePath,
          severity: 'high',
          suggestion: 'Async functions should have proper error handling'
        });
      }

    } catch (error) {
      console.error(`Error scanning file ${filePath}:`, error.message);
    }
  }

  // Scan directory recursively
  scanDirectory(dirPath, excludeDirs = ['node_modules', '.git', 'logs']) {
    try {
      const items = fs.readdirSync(dirPath);
      
      items.forEach(item => {
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !excludeDirs.includes(item)) {
          this.scanDirectory(fullPath, excludeDirs);
        } else if (stat.isFile() && (item.endsWith('.js') || item.endsWith('.json'))) {
          this.scanFile(fullPath);
        }
      });
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error.message);
    }
  }

  // Generate report
  generateReport() {
    console.log('\n🔍 Backend Cleanup Report');
    console.log('========================\n');
    
    console.log(`📊 Statistics:`);
    console.log(`   Files scanned: ${this.stats.filesScanned}`);
    console.log(`   Issues found: ${this.issues.length}`);
    console.log(`   Suggestions: ${this.suggestions.length}\n`);

    // Group issues by type
    const issuesByType = {};
    this.issues.forEach(issue => {
      if (!issuesByType[issue.type]) {
        issuesByType[issue.type] = [];
      }
      issuesByType[issue.type].push(issue);
    });

    // Display issues
    Object.keys(issuesByType).forEach(type => {
      const issues = issuesByType[type];
      console.log(`🚨 ${type.toUpperCase()} Issues (${issues.length}):`);
      
      issues.slice(0, 10).forEach(issue => { // Show max 10 per type
        console.log(`   📁 ${path.relative(process.cwd(), issue.file)}`);
        if (issue.line) console.log(`   📍 Line ${issue.line}`);
        if (issue.content) console.log(`   📝 ${issue.content}`);
        console.log(`   💡 ${issue.suggestion}`);
        console.log(`   ⚠️  Severity: ${issue.severity}\n`);
      });
      
      if (issues.length > 10) {
        console.log(`   ... and ${issues.length - 10} more\n`);
      }
    });

    // Display suggestions
    if (this.suggestions.length > 0) {
      console.log(`💡 Optimization Suggestions (${this.suggestions.length}):`);
      this.suggestions.slice(0, 10).forEach(suggestion => {
        console.log(`   📁 ${path.relative(process.cwd(), suggestion.file)}`);
        console.log(`   💡 ${suggestion.suggestion}\n`);
      });
    }

    // General recommendations
    console.log('🎯 General Recommendations:');
    console.log('   1. Replace all console.log with Winston logging');
    console.log('   2. Move hardcoded values to environment variables');
    console.log('   3. Add comprehensive error handling to all async functions');
    console.log('   4. Remove unused imports and dependencies');
    console.log('   5. Add JSDoc comments to all functions');
    console.log('   6. Consider implementing request/response caching');
    console.log('   7. Add comprehensive unit and integration tests');
    console.log('   8. Implement database query optimization');
    console.log('   9. Add API response compression for large payloads');
    console.log('   10. Consider implementing GraphQL for complex queries\n');

    // Performance recommendations
    console.log('⚡ Performance Recommendations:');
    console.log('   1. Implement Redis caching for frequently accessed data');
    console.log('   2. Add database indexing for common queries');
    console.log('   3. Implement connection pooling optimization');
    console.log('   4. Add response compression middleware');
    console.log('   5. Optimize Socket.IO for production scaling');
    console.log('   6. Implement lazy loading for large datasets');
    console.log('   7. Add request/response caching headers');
    console.log('   8. Consider implementing CDN for static assets\n');

    // Security recommendations
    console.log('🔒 Security Recommendations:');
    console.log('   1. Implement API key authentication for service-to-service calls');
    console.log('   2. Add request signing for sensitive operations');
    console.log('   3. Implement audit logging for all user actions');
    console.log('   4. Add IP whitelisting for admin operations');
    console.log('   5. Implement session management and timeout');
    console.log('   6. Add CSRF protection for state-changing operations');
    console.log('   7. Implement proper password policies');
    console.log('   8. Add two-factor authentication support\n');
  }

  // Run cleanup
  run() {
    console.log('🚀 Starting Backend Cleanup Analysis...\n');
    
    const backendPath = process.cwd();
    this.scanDirectory(backendPath);
    this.generateReport();
    
    console.log('✅ Cleanup analysis complete!');
    console.log('📋 Review the issues and suggestions above to improve your backend.\n');
  }
}

// Run if called directly
if (require.main === module) {
  const cleanup = new BackendCleanup();
  cleanup.run();
}

module.exports = BackendCleanup;
