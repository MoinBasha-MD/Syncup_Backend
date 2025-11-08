#!/usr/bin/env node

/**
 * Migration Helper for Encrypted Logging
 * Helps identify and update console.log statements with sensitive data
 */

const fs = require('fs');
const path = require('path');

class LoggingMigrationHelper {
  constructor() {
    this.sensitivePatterns = [
      /console\.log.*name/i,
      /console\.log.*phone/i,
      /console\.log.*email/i,
      /console\.log.*password/i,
      /console\.log.*token/i,
      /console\.log.*address/i,
      /console\.log.*mobile/i
    ];
    
    this.findings = [];
  }

  scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        this.sensitivePatterns.forEach(pattern => {
          if (pattern.test(line)) {
            this.findings.push({
              file: filePath,
              line: index + 1,
              content: line.trim(),
              suggestion: this.generateSuggestion(line)
            });
          }
        });
      });
    } catch (error) {
      console.error(`Error scanning ${filePath}:`, error.message);
    }
  }

  scanDirectory(dirPath, extensions = ['.js']) {
    try {
      const items = fs.readdirSync(dirPath);
      
      items.forEach(item => {
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          // Skip node_modules and other common directories
          if (!['node_modules', '.git', 'logs', 'uploads'].includes(item)) {
            this.scanDirectory(fullPath, extensions);
          }
        } else if (stat.isFile()) {
          const ext = path.extname(item);
          if (extensions.includes(ext)) {
            this.scanFile(fullPath);
          }
        }
      });
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error.message);
    }
  }

  generateSuggestion(line) {
    // Extract variable names from the log statement
    const matches = line.match(/\$\{([^}]+)\}/g) || [];
    const variables = matches.map(m => m.replace(/\$\{|\}/g, ''));
    
    if (variables.length === 0) {
      return 'logServerSafe(\'info\', \'Your message\', { /* data */ }, \'mask\');';
    }
    
    // Generate object from variables
    const dataObj = variables.map(v => {
      const varName = v.split('.').pop();
      return `${varName}: ${v}`;
    }).join(', ');
    
    return `logServerSafe('info', 'Your message', { ${dataObj} }, 'mask');`;
  }

  generateReport() {
    console.log('\n' + '='.repeat(80));
    console.log('ENCRYPTED LOGGING MIGRATION REPORT');
    console.log('='.repeat(80) + '\n');
    
    if (this.findings.length === 0) {
      console.log('✅ No sensitive console.log statements found!\n');
      return;
    }
    
    console.log(`Found ${this.findings.length} potential issues:\n`);
    
    // Group by file
    const byFile = {};
    this.findings.forEach(finding => {
      if (!byFile[finding.file]) {
        byFile[finding.file] = [];
      }
      byFile[finding.file].push(finding);
    });
    
    Object.entries(byFile).forEach(([file, findings]) => {
      console.log(`\n📄 ${file}`);
      console.log('-'.repeat(80));
      
      findings.forEach(finding => {
        console.log(`\nLine ${finding.line}:`);
        console.log(`  Current: ${finding.content}`);
        console.log(`  Suggested: ${finding.suggestion}`);
      });
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('MIGRATION STEPS:');
    console.log('='.repeat(80));
    console.log('1. Add import: const { logServerSafe } = require(\'./utils/loggerSetup\');');
    console.log('2. Replace console.log with logServerSafe as shown above');
    console.log('3. Choose encryption mode: mask (default), encrypt, or hash');
    console.log('4. Test your changes');
    console.log('5. Run this script again to verify\n');
  }

  saveReport(outputPath) {
    const report = {
      timestamp: new Date().toISOString(),
      totalFindings: this.findings.length,
      findings: this.findings
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\n📝 Report saved to: ${outputPath}\n`);
  }
}

// CLI Usage
if (require.main === module) {
  const helper = new LoggingMigrationHelper();
  
  // Get directory from command line or use current directory
  const targetDir = process.argv[2] || path.join(__dirname, '..');
  
  console.log(`\n🔍 Scanning ${targetDir} for sensitive console.log statements...\n`);
  
  helper.scanDirectory(targetDir);
  helper.generateReport();
  
  // Save report
  const reportPath = path.join(__dirname, '../logs/migration-report.json');
  helper.saveReport(reportPath);
}

module.exports = LoggingMigrationHelper;
