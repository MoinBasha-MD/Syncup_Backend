const winston = require('winston');
const crypto = require('crypto');
const User = require('../../models/userModel');
const { connectionLogger } = require('../../utils/loggerSetup');

// Configure logger for Security Agent
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/security-agent.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class SecurityAgent {
  constructor() {
    this.agentId = null;
    this.isActive = false;
    this.threatDatabase = new Map(); // IP -> threat data
    this.suspiciousActivities = new Map(); // userId -> activity data
    this.rateLimitTracking = new Map(); // IP -> request data
    this.securityRules = new Map(); // ruleId -> rule config
    
    this.metrics = {
      threatsDetected: 0,
      threatsBlocked: 0,
      falsePositives: 0,
      averageResponseTime: 0,
      securityScans: 0
    };
    
    // Initialize security rules
    this.initializeSecurityRules();
  }

  /**
   * Initialize the security agent
   */
  async initialize(agentId) {
    this.agentId = agentId;
    this.isActive = true;
    
    logger.info(`🛡️ Security Agent ${agentId} initialized`);
    
    // Start continuous monitoring
    this.startContinuousMonitoring();
  }

  /**
   * Process a security task
   */
  async processTask(payload, context) {
    const startTime = Date.now();
    
    try {
      const { action, data } = payload;
      let result;
      
      switch (action) {
        case 'analyze_request':
          result = await this.analyzeRequest(data, context);
          break;
        case 'detect_anomaly':
          result = await this.detectAnomaly(data, context);
          break;
        case 'validate_user_behavior':
          result = await this.validateUserBehavior(data, context);
          break;
        case 'scan_for_threats':
          result = await this.scanForThreats(data, context);
          break;
        case 'block_suspicious_activity':
          result = await this.blockSuspiciousActivity(data, context);
          break;
        case 'generate_security_report':
          result = await this.generateSecurityReport(data, context);
          break;
        default:
          throw new Error(`Unknown security action: ${action}`);
      }
      
      const responseTime = Date.now() - startTime;
      this.updateMetrics(responseTime, true);
      
      return result;
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.updateMetrics(responseTime, false);
      
      logger.error(`❌ Security task failed:`, error);
      throw error;
    }
  }

  /**
   * Analyze incoming request for security threats
   */
  async analyzeRequest(data, context) {
    const { request, clientIP, userAgent, headers } = data;
    
    try {
      const analysis = {
        riskScore: 0,
        threats: [],
        recommendations: [],
        blocked: false
      };
      
      // Check IP reputation
      const ipThreat = this.checkIPReputation(clientIP);
      if (ipThreat.isBlacklisted) {
        analysis.riskScore += 80;
        analysis.threats.push({
          type: 'blacklisted_ip',
          severity: 'high',
          details: ipThreat.reason
        });
      }
      
      // Analyze user agent
      const uaThreat = this.analyzeUserAgent(userAgent);
      if (uaThreat.suspicious) {
        analysis.riskScore += 30;
        analysis.threats.push({
          type: 'suspicious_user_agent',
          severity: 'medium',
          details: uaThreat.reason
        });
      }
      
      // Check for SQL injection patterns
      const sqlThreat = this.detectSQLInjection(request);
      if (sqlThreat.detected) {
        analysis.riskScore += 90;
        analysis.threats.push({
          type: 'sql_injection',
          severity: 'critical',
          details: sqlThreat.patterns
        });
      }
      
      // Check for XSS patterns
      const xssThreat = this.detectXSS(request);
      if (xssThreat.detected) {
        analysis.riskScore += 70;
        analysis.threats.push({
          type: 'xss_attempt',
          severity: 'high',
          details: xssThreat.patterns
        });
      }
      
      // Rate limiting check
      const rateLimitThreat = this.checkRateLimit(clientIP, request);
      if (rateLimitThreat.exceeded) {
        analysis.riskScore += 50;
        analysis.threats.push({
          type: 'rate_limit_exceeded',
          severity: 'medium',
          details: rateLimitThreat.details
        });
      }
      
      // Determine if request should be blocked
      analysis.blocked = analysis.riskScore >= 70;
      
      // Generate recommendations
      if (analysis.riskScore > 30) {
        analysis.recommendations.push('Enable additional monitoring for this IP');
      }
      if (analysis.riskScore > 50) {
        analysis.recommendations.push('Consider implementing CAPTCHA verification');
      }
      if (analysis.blocked) {
        analysis.recommendations.push('Block request and log incident');
        this.logSecurityIncident(clientIP, analysis.threats);
      }
      
      // Update threat database
      this.updateThreatDatabase(clientIP, analysis);
      
      return {
        clientIP,
        analysis,
        timestamp: new Date(),
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Request analysis failed:', error);
      throw error;
    }
  }

  /**
   * Detect behavioral anomalies
   */
  async detectAnomaly(data, context) {
    const { userId, activity, sessionData } = data;
    
    try {
      const anomalies = [];
      
      // Get user's normal behavior pattern
      const userPattern = await this.getUserBehaviorPattern(userId);
      
      // Check login patterns
      const loginAnomaly = this.detectLoginAnomaly(activity, userPattern);
      if (loginAnomaly.detected) {
        anomalies.push({
          type: 'unusual_login_pattern',
          severity: loginAnomaly.severity,
          details: loginAnomaly.details,
          confidence: loginAnomaly.confidence
        });
      }
      
      // Check access patterns
      const accessAnomaly = this.detectAccessAnomaly(activity, userPattern);
      if (accessAnomaly.detected) {
        anomalies.push({
          type: 'unusual_access_pattern',
          severity: accessAnomaly.severity,
          details: accessAnomaly.details,
          confidence: accessAnomaly.confidence
        });
      }
      
      // Check data access patterns
      const dataAnomaly = this.detectDataAccessAnomaly(activity, userPattern);
      if (dataAnomaly.detected) {
        anomalies.push({
          type: 'unusual_data_access',
          severity: dataAnomaly.severity,
          details: dataAnomaly.details,
          confidence: dataAnomaly.confidence
        });
      }
      
      // Update user activity tracking
      this.updateUserActivity(userId, activity);
      
      // Generate alerts for high-confidence anomalies
      const highConfidenceAnomalies = anomalies.filter(a => a.confidence > 0.8);
      if (highConfidenceAnomalies.length > 0) {
        await this.generateSecurityAlert(userId, highConfidenceAnomalies);
      }
      
      return {
        userId,
        anomalies,
        riskScore: this.calculateRiskScore(anomalies),
        recommendations: this.generateAnomalyRecommendations(anomalies),
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Anomaly detection failed:', error);
      throw error;
    }
  }

  /**
   * Validate user behavior against security policies
   */
  async validateUserBehavior(data, context) {
    const { userId, action, requestData } = data;
    
    try {
      const validation = {
        allowed: true,
        violations: [],
        riskScore: 0,
        requiredActions: []
      };
      
      // Get user security profile
      const user = await User.findOne({ userId });
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Check account status
      if (user.accountStatus === 'suspended' || user.accountStatus === 'banned') {
        validation.allowed = false;
        validation.violations.push({
          type: 'account_suspended',
          severity: 'critical',
          message: 'Account is suspended or banned'
        });
      }
      
      // Check for privilege escalation attempts
      const privilegeCheck = this.checkPrivilegeEscalation(user, action, requestData);
      if (privilegeCheck.detected) {
        validation.riskScore += 80;
        validation.violations.push({
          type: 'privilege_escalation',
          severity: 'high',
          details: privilegeCheck.details
        });
      }
      
      // Check for data exfiltration patterns
      const exfiltrationCheck = this.checkDataExfiltration(userId, action, requestData);
      if (exfiltrationCheck.detected) {
        validation.riskScore += 90;
        validation.violations.push({
          type: 'data_exfiltration',
          severity: 'critical',
          details: exfiltrationCheck.details
        });
      }
      
      // Check session validity
      const sessionCheck = this.validateSession(userId, context.sessionId);
      if (!sessionCheck.valid) {
        validation.allowed = false;
        validation.violations.push({
          type: 'invalid_session',
          severity: 'high',
          details: sessionCheck.reason
        });
      }
      
      // Determine final decision
      if (validation.riskScore >= 70) {
        validation.allowed = false;
        validation.requiredActions.push('immediate_verification');
      } else if (validation.riskScore >= 40) {
        validation.requiredActions.push('additional_authentication');
      }
      
      return {
        userId,
        action,
        validation,
        timestamp: new Date(),
        success: true
      };
      
    } catch (error) {
      logger.error('❌ User behavior validation failed:', error);
      throw error;
    }
  }

  /**
   * Scan system for security threats
   */
  async scanForThreats(data, context) {
    const { scanType = 'full', targets = [] } = data;
    
    try {
      this.metrics.securityScans++;
      
      const scanResults = {
        scanType,
        startTime: new Date(),
        threats: [],
        vulnerabilities: [],
        recommendations: []
      };
      
      // Scan for suspicious user accounts
      const suspiciousAccounts = await this.scanSuspiciousAccounts();
      scanResults.threats.push(...suspiciousAccounts);
      
      // Scan for unusual network activity
      const networkThreats = await this.scanNetworkActivity();
      scanResults.threats.push(...networkThreats);
      
      // Scan for data integrity issues
      const integrityIssues = await this.scanDataIntegrity();
      scanResults.vulnerabilities.push(...integrityIssues);
      
      // Scan for configuration vulnerabilities
      const configVulns = await this.scanConfiguration();
      scanResults.vulnerabilities.push(...configVulns);
      
      // Generate recommendations based on findings
      scanResults.recommendations = this.generateScanRecommendations(
        scanResults.threats,
        scanResults.vulnerabilities
      );
      
      scanResults.endTime = new Date();
      scanResults.duration = scanResults.endTime - scanResults.startTime;
      
      // Log scan results
      logger.info(`🔍 Security scan completed: ${scanResults.threats.length} threats, ${scanResults.vulnerabilities.length} vulnerabilities found`);
      
      return {
        scanResults,
        summary: {
          threatsFound: scanResults.threats.length,
          vulnerabilitiesFound: scanResults.vulnerabilities.length,
          criticalIssues: [...scanResults.threats, ...scanResults.vulnerabilities]
            .filter(item => item.severity === 'critical').length,
          scanDuration: scanResults.duration
        },
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Security scan failed:', error);
      throw error;
    }
  }

  /**
   * Monitor system for security events
   */
  async monitorSystem(payload, context) {
    try {
      const monitoring = {
        activeThreats: this.threatDatabase.size,
        suspiciousUsers: this.suspiciousActivities.size,
        securityRules: this.securityRules.size,
        metrics: this.metrics,
        systemHealth: {
          threatDetectionRate: this.calculateThreatDetectionRate(),
          falsePositiveRate: this.calculateFalsePositiveRate(),
          averageResponseTime: this.metrics.averageResponseTime,
          memoryUsage: process.memoryUsage().heapUsed
        },
        recentAlerts: await this.getRecentSecurityAlerts()
      };
      
      // Check for critical security metrics
      const alerts = [];
      
      if (monitoring.systemHealth.falsePositiveRate > 0.1) {
        alerts.push({
          type: 'high_false_positive_rate',
          severity: 'warning',
          value: monitoring.systemHealth.falsePositiveRate
        });
      }
      
      if (monitoring.activeThreats > 100) {
        alerts.push({
          type: 'high_threat_count',
          severity: 'critical',
          value: monitoring.activeThreats
        });
      }
      
      monitoring.alerts = alerts;
      
      return monitoring;
      
    } catch (error) {
      logger.error('❌ Security monitoring failed:', error);
      throw error;
    }
  }

  /**
   * Health check for the security agent
   */
  async healthCheck() {
    return {
      status: this.isActive ? 'healthy' : 'inactive',
      threatsTracked: this.threatDatabase.size,
      securityRules: this.securityRules.size,
      metrics: this.metrics,
      lastActivity: new Date()
    };
  }

  // Helper methods

  /**
   * Initialize security rules
   */
  initializeSecurityRules() {
    // SQL Injection patterns
    this.securityRules.set('sql_injection', {
      patterns: [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
        /(\b(OR|AND)\s+\d+\s*=\s*\d+)/i,
        /(\'|\"|;|--|\*|\/\*|\*\/)/,
        /(\b(SCRIPT|JAVASCRIPT|VBSCRIPT|ONLOAD|ONERROR)\b)/i
      ],
      severity: 'critical'
    });
    
    // XSS patterns
    this.securityRules.set('xss', {
      patterns: [
        /<script[^>]*>.*?<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /<iframe[^>]*>.*?<\/iframe>/gi
      ],
      severity: 'high'
    });
    
    // Path traversal patterns
    this.securityRules.set('path_traversal', {
      patterns: [
        /\.\.\//g,
        /\.\.\\/g,
        /%2e%2e%2f/gi,
        /%252e%252e%252f/gi
      ],
      severity: 'high'
    });
  }

  /**
   * Check IP reputation
   */
  checkIPReputation(ip) {
    const threatData = this.threatDatabase.get(ip);
    
    if (!threatData) {
      return { isBlacklisted: false };
    }
    
    return {
      isBlacklisted: threatData.riskScore > 80,
      reason: threatData.lastThreat,
      riskScore: threatData.riskScore
    };
  }

  /**
   * Analyze user agent for suspicious patterns
   */
  analyzeUserAgent(userAgent) {
    if (!userAgent) {
      return { suspicious: true, reason: 'Missing user agent' };
    }
    
    // Check for bot patterns
    const botPatterns = [
      /bot/i, /crawler/i, /spider/i, /scraper/i,
      /curl/i, /wget/i, /python/i, /java/i
    ];
    
    for (const pattern of botPatterns) {
      if (pattern.test(userAgent)) {
        return { suspicious: true, reason: 'Bot-like user agent detected' };
      }
    }
    
    return { suspicious: false };
  }

  /**
   * Detect SQL injection attempts
   */
  detectSQLInjection(request) {
    const sqlRule = this.securityRules.get('sql_injection');
    const detectedPatterns = [];
    
    const requestString = JSON.stringify(request).toLowerCase();
    
    for (const pattern of sqlRule.patterns) {
      if (pattern.test(requestString)) {
        detectedPatterns.push(pattern.toString());
      }
    }
    
    return {
      detected: detectedPatterns.length > 0,
      patterns: detectedPatterns
    };
  }

  /**
   * Detect XSS attempts
   */
  detectXSS(request) {
    const xssRule = this.securityRules.get('xss');
    const detectedPatterns = [];
    
    const requestString = JSON.stringify(request);
    
    for (const pattern of xssRule.patterns) {
      if (pattern.test(requestString)) {
        detectedPatterns.push(pattern.toString());
      }
    }
    
    return {
      detected: detectedPatterns.length > 0,
      patterns: detectedPatterns
    };
  }

  /**
   * Check rate limiting
   */
  checkRateLimit(ip, request) {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    const maxRequests = 100; // Max requests per window
    
    let ipData = this.rateLimitTracking.get(ip);
    if (!ipData) {
      ipData = { requests: [], firstRequest: now };
      this.rateLimitTracking.set(ip, ipData);
    }
    
    // Clean old requests
    ipData.requests = ipData.requests.filter(time => now - time < windowMs);
    
    // Add current request
    ipData.requests.push(now);
    
    const exceeded = ipData.requests.length > maxRequests;
    
    return {
      exceeded,
      details: {
        requestCount: ipData.requests.length,
        maxRequests,
        windowMs,
        resetTime: now + windowMs
      }
    };
  }

  /**
   * Update threat database
   */
  updateThreatDatabase(ip, analysis) {
    let threatData = this.threatDatabase.get(ip);
    
    if (!threatData) {
      threatData = {
        firstSeen: new Date(),
        riskScore: 0,
        threatCount: 0,
        lastThreat: null
      };
    }
    
    threatData.lastSeen = new Date();
    threatData.riskScore = Math.max(threatData.riskScore, analysis.riskScore);
    
    if (analysis.threats.length > 0) {
      threatData.threatCount++;
      threatData.lastThreat = analysis.threats[0].type;
      this.metrics.threatsDetected++;
    }
    
    this.threatDatabase.set(ip, threatData);
  }

  /**
   * Log security incident
   */
  logSecurityIncident(ip, threats) {
    const incident = {
      timestamp: new Date(),
      ip,
      threats,
      severity: Math.max(...threats.map(t => 
        t.severity === 'critical' ? 4 : 
        t.severity === 'high' ? 3 : 
        t.severity === 'medium' ? 2 : 1
      ))
    };
    
    logger.warn('🚨 Security incident detected:', incident);
    connectionLogger.warn('Security incident', incident);
  }

  /**
   * Start continuous monitoring
   */
  startContinuousMonitoring() {
    // Monitor threat database size and cleanup old entries
    setInterval(() => {
      const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
      
      for (const [ip, data] of this.threatDatabase) {
        if (data.lastSeen && data.lastSeen.getTime() < cutoffTime && data.riskScore < 50) {
          this.threatDatabase.delete(ip);
        }
      }
      
      // Cleanup rate limit tracking
      for (const [ip, data] of this.rateLimitTracking) {
        if (data.requests.length === 0) {
          this.rateLimitTracking.delete(ip);
        }
      }
      
    }, 60 * 60 * 1000); // Every hour
  }

  /**
   * Update agent metrics
   */
  updateMetrics(responseTime, success) {
    const totalResponses = this.metrics.threatsDetected + this.metrics.threatsBlocked;
    this.metrics.averageResponseTime = 
      ((this.metrics.averageResponseTime * totalResponses) + responseTime) / (totalResponses + 1);
  }

  /**
   * Calculate threat detection rate
   */
  calculateThreatDetectionRate() {
    const total = this.metrics.threatsDetected + this.metrics.threatsBlocked;
    return total > 0 ? this.metrics.threatsDetected / total : 0;
  }

  /**
   * Calculate false positive rate
   */
  calculateFalsePositiveRate() {
    const total = this.metrics.threatsDetected + this.metrics.falsePositives;
    return total > 0 ? this.metrics.falsePositives / total : 0;
  }

  /**
   * Get recent security alerts (placeholder)
   */
  async getRecentSecurityAlerts() {
    // This would typically query a security alerts database
    return [];
  }
}

module.exports = SecurityAgent;
