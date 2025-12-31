/**
 * IP Blocking Middleware
 * Blocks known malicious IPs and suspicious attack patterns
 */

// List of blocked IPs (update as needed)
const blockedIPs = [
  '47.252.4.54', // CVE-2024-4577 PHP RCE attack attempt - Dec 31, 2025
];

// Suspicious patterns that indicate attacks
const suspiciousPatterns = [
  /\.php$/i,
  /phpunit/i,
  /eval-stdin/i,
  /allow_url_include/i,
  /base64_decode/i,
  /shell_exec/i,
  /auto_prepend_file/i,
  /\/vendor\//i,
  /CVE-\d{4}-\d{4}/i,
];

/**
 * IP Blocker Middleware
 */
const ipBlocker = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
  
  // Extract actual IP if behind proxy
  const actualIP = clientIP?.split(',')[0]?.trim();
  
  // Check if IP is blocked
  if (blockedIPs.includes(actualIP)) {
    console.log(`🚫 [SECURITY] Blocked request from banned IP: ${actualIP}`);
    console.log(`   Path: ${req.path}`);
    console.log(`   Method: ${req.method}`);
    console.log(`   User-Agent: ${req.get('user-agent')}`);
    
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }
  
  next();
};

/**
 * Suspicious Pattern Detector
 * Logs and monitors suspicious requests
 */
const suspiciousPatternDetector = (req, res, next) => {
  const fullPath = req.path + JSON.stringify(req.query) + JSON.stringify(req.body);
  const clientIP = req.ip || req.connection.remoteAddress;
  
  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(fullPath));
  
  if (isSuspicious) {
    console.log(`🚨 [SECURITY ALERT] Suspicious request detected:`);
    console.log(`   IP: ${clientIP}`);
    console.log(`   Path: ${req.path}`);
    console.log(`   Method: ${req.method}`);
    console.log(`   Query: ${JSON.stringify(req.query)}`);
    console.log(`   User-Agent: ${req.get('user-agent')}`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    
    // Optional: Auto-block after multiple suspicious requests
    // This would require a rate tracking mechanism
  }
  
  next();
};

/**
 * Add IP to blocklist (can be called from other parts of the app)
 */
const addBlockedIP = (ip) => {
  if (!blockedIPs.includes(ip)) {
    blockedIPs.push(ip);
    console.log(`🚫 [SECURITY] Added IP to blocklist: ${ip}`);
    return true;
  }
  return false;
};

/**
 * Remove IP from blocklist
 */
const removeBlockedIP = (ip) => {
  const index = blockedIPs.indexOf(ip);
  if (index > -1) {
    blockedIPs.splice(index, 1);
    console.log(`✅ [SECURITY] Removed IP from blocklist: ${ip}`);
    return true;
  }
  return false;
};

/**
 * Get current blocklist
 */
const getBlockedIPs = () => {
  return [...blockedIPs];
};

module.exports = {
  ipBlocker,
  suspiciousPatternDetector,
  addBlockedIP,
  removeBlockedIP,
  getBlockedIPs
};
