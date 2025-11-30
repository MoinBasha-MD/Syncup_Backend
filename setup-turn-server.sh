#!/bin/bash

# TURN Server Setup Script for Syncup Backend
# Run this on your backend server: 45.129.86.96

echo "========================================="
echo "SYNCUP TURN SERVER SETUP"
echo "========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "❌ Please run as root (use sudo)"
  exit 1
fi

echo "✅ Running as root"
echo ""

# Step 1: Update system
echo "📦 Step 1: Updating system packages..."
apt-get update -y
echo "✅ System updated"
echo ""

# Step 2: Install coturn
echo "📦 Step 2: Installing coturn..."
apt-get install -y coturn
echo "✅ Coturn installed"
echo ""

# Step 3: Enable coturn
echo "⚙️ Step 3: Enabling coturn service..."
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
echo "✅ Coturn enabled"
echo ""

# Step 4: Backup existing config
echo "💾 Step 4: Backing up existing configuration..."
if [ -f /etc/turnserver.conf ]; then
  cp /etc/turnserver.conf /etc/turnserver.conf.backup.$(date +%Y%m%d_%H%M%S)
  echo "✅ Backup created"
else
  echo "ℹ️ No existing config to backup"
fi
echo ""

# Step 5: Create new configuration
echo "⚙️ Step 5: Creating TURN server configuration..."
cat > /etc/turnserver.conf << 'EOF'
# Syncup TURN Server Configuration
# Generated: $(date)

# TURN server name and realm
realm=syncup.com
server-name=syncup-turn

# Listening ports
listening-port=3478
tls-listening-port=5349

# External IP (your server IP)
external-ip=45.129.86.96

# User authentication
user=syncup:Syncup@786
lt-cred-mech

# Logging
verbose
log-file=/var/log/turnserver.log

# Security
fingerprint
no-multicast-peers

# Performance
max-bps=1000000

# Relay configuration
min-port=49152
max-port=65535

# Additional security
no-loopback-peers
no-multicast-peers
stale-nonce=600
EOF

echo "✅ Configuration created"
echo ""

# Step 6: Set permissions
echo "🔒 Step 6: Setting permissions..."
chmod 644 /etc/turnserver.conf
chown turnserver:turnserver /etc/turnserver.conf
echo "✅ Permissions set"
echo ""

# Step 7: Configure firewall
echo "🔥 Step 7: Configuring firewall..."
ufw allow 3478/udp comment 'TURN UDP'
ufw allow 3478/tcp comment 'TURN TCP'
ufw allow 5349/tcp comment 'TURN TLS'
ufw allow 49152:65535/udp comment 'TURN relay ports'
echo "✅ Firewall configured"
echo ""

# Step 8: Start coturn service
echo "🚀 Step 8: Starting coturn service..."
systemctl stop coturn 2>/dev/null
systemctl start coturn
systemctl enable coturn
echo "✅ Coturn started and enabled"
echo ""

# Step 9: Check status
echo "📊 Step 9: Checking service status..."
sleep 2
if systemctl is-active --quiet coturn; then
  echo "✅ Coturn is running!"
else
  echo "❌ Coturn failed to start"
  echo "Check logs: sudo journalctl -u coturn -n 50"
  exit 1
fi
echo ""

# Step 10: Display status
echo "========================================="
echo "✅ TURN SERVER SETUP COMPLETE!"
echo "========================================="
echo ""
echo "📊 Service Status:"
systemctl status coturn --no-pager -l
echo ""
echo "📝 Configuration:"
echo "  - TURN Server: 45.129.86.96:3478"
echo "  - TLS Port: 5349"
echo "  - Username: syncup"
echo "  - Password: Syncup@786"
echo "  - Realm: syncup.com"
echo ""
echo "🔍 Useful Commands:"
echo "  - Check status: sudo systemctl status coturn"
echo "  - View logs: sudo journalctl -u coturn -f"
echo "  - Restart: sudo systemctl restart coturn"
echo "  - Stop: sudo systemctl stop coturn"
echo ""
echo "🧪 Test TURN Server:"
echo "  1. Install test tools: sudo apt-get install libnice-dev"
echo "  2. Test: turnutils_uclient -v -u syncup -w Syncup@786 45.129.86.96"
echo ""
echo "📱 Next Steps:"
echo "  1. Rebuild your React Native app"
echo "  2. Make a test call"
echo "  3. Check logs for 'relay' type ICE candidates"
echo ""
echo "========================================="
