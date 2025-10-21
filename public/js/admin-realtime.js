// Admin Panel Real-time Updates using Socket.IO

class AdminRealtime {
    constructor() {
        this.socket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.init();
    }
    
    init() {
        // Connect to Socket.IO server
        this.socket = io({
            transports: ['websocket', 'polling']
        });
        
        this.socket.on('connect', () => {
            console.log('✅ Real-time connection established');
            this.reconnectAttempts = 0;
            this.showConnectionStatus('connected');
            
            // Join admin room
            this.socket.emit('join-admin-room');
        });
        
        this.socket.on('disconnect', () => {
            console.log('❌ Real-time connection lost');
            this.showConnectionStatus('disconnected');
        });
        
        this.socket.on('reconnect_attempt', () => {
            this.reconnectAttempts++;
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                console.log('Max reconnection attempts reached');
            }
        });
        
        // Listen for real-time events
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // New user registered
        this.socket.on('admin:new-user', (data) => {
            this.showNotification('New User', `${data.name} just registered!`, 'success');
            this.updateUserCount();
        });
        
        // New message sent
        this.socket.on('admin:new-message', (data) => {
            this.updateMessageCount();
        });
        
        // New post created
        this.socket.on('admin:new-post', (data) => {
            this.updatePostCount();
        });
        
        // User status changed
        this.socket.on('admin:status-change', (data) => {
            this.showNotification('Status Update', `${data.userName} changed status to ${data.status}`, 'info');
        });
        
        // System alert
        this.socket.on('admin:system-alert', (data) => {
            this.showNotification('System Alert', data.message, data.type || 'warning');
        });
    }
    
    showConnectionStatus(status) {
        const indicator = document.getElementById('connection-indicator');
        if (indicator) {
            if (status === 'connected') {
                indicator.className = 'connection-indicator connected';
                indicator.title = 'Real-time updates active';
            } else {
                indicator.className = 'connection-indicator disconnected';
                indicator.title = 'Real-time updates inactive';
            }
        }
    }
    
    showNotification(title, message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `realtime-notification ${type}`;
        notification.innerHTML = `
            <div class="notification-icon">
                <i class="fas ${this.getIconForType(type)}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title">${title}</div>
                <div class="notification-message">${message}</div>
            </div>
            <button class="notification-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        // Add to container
        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            document.body.appendChild(container);
        }
        
        container.appendChild(notification);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, 5000);
        
        // Play notification sound (optional)
        this.playNotificationSound();
    }
    
    getIconForType(type) {
        const icons = {
            success: 'fa-check-circle',
            info: 'fa-info-circle',
            warning: 'fa-exclamation-triangle',
            error: 'fa-times-circle'
        };
        return icons[type] || 'fa-bell';
    }
    
    playNotificationSound() {
        // Optional: Play a subtle notification sound
        // const audio = new Audio('/sounds/notification.mp3');
        // audio.volume = 0.3;
        // audio.play().catch(e => console.log('Sound play failed'));
    }
    
    async updateUserCount() {
        try {
            const res = await fetch('/admin/api/stats/users');
            const data = await res.json();
            const element = document.querySelector('[data-stat="total-users"]');
            if (element) {
                element.textContent = data.count;
                element.classList.add('stat-updated');
                setTimeout(() => element.classList.remove('stat-updated'), 1000);
            }
        } catch (error) {
            console.error('Error updating user count:', error);
        }
    }
    
    async updateMessageCount() {
        try {
            const res = await fetch('/admin/api/stats/messages');
            const data = await res.json();
            const element = document.querySelector('[data-stat="total-messages"]');
            if (element) {
                element.textContent = data.count;
                element.classList.add('stat-updated');
                setTimeout(() => element.classList.remove('stat-updated'), 1000);
            }
        } catch (error) {
            console.error('Error updating message count:', error);
        }
    }
    
    async updatePostCount() {
        try {
            const res = await fetch('/admin/api/stats/posts');
            const data = await res.json();
            const element = document.querySelector('[data-stat="total-posts"]');
            if (element) {
                element.textContent = data.count;
                element.classList.add('stat-updated');
                setTimeout(() => element.classList.remove('stat-updated'), 1000);
            }
        } catch (error) {
            console.error('Error updating post count:', error);
        }
    }
}

// Initialize real-time updates when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.adminRealtime = new AdminRealtime();
});
