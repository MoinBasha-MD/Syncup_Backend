// Configuration
const API_BASE_URL = window.location.origin + '/api/users';

// Debug logging
console.log('Admin Panel Initialized');
console.log('API Base URL:', API_BASE_URL);

// Global variables
let currentUsers = [];
let resetCount = 0;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    loadAllUsers();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchUsers();
        }
    });
}

// Attach event listeners to dynamically created buttons
function attachEventListeners() {
    // Remove existing listeners to prevent duplicates
    document.querySelectorAll('[data-action]').forEach(button => {
        button.replaceWith(button.cloneNode(true));
    });
    
    // Add event listeners using event delegation
    document.getElementById('usersContainer').addEventListener('click', function(e) {
        const button = e.target.closest('[data-action]');
        if (!button) return;
        
        const action = button.getAttribute('data-action');
        const userId = button.getAttribute('data-user-id');
        const userEmail = button.getAttribute('data-user-email');
        
        console.log('Button clicked:', { action, userId, userEmail });
        
        switch (action) {
            case 'show-form':
                showResetForm(userId);
                break;
            case 'reset':
                resetPassword(userId, userEmail);
                break;
            case 'cancel':
                cancelReset(userId);
                break;
        }
    });
}

// Show loading state
function showLoading() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('usersContainer').style.display = 'none';
}

// Hide loading state
function hideLoading() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('usersContainer').style.display = 'grid';
}

// Show alert message
function showAlert(message, type = 'success') {
    const alertsContainer = document.getElementById('alerts');
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-triangle'}"></i>
        ${message}
    `;
    
    alertsContainer.appendChild(alertDiv);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
    
    // Scroll to top to show alert
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Load all users
async function loadAllUsers() {
    showLoading();
    try {
        console.log('Fetching users from:', `${API_BASE_URL}/admin/all`);
        const response = await fetch(`${API_BASE_URL}/admin/all`);
        console.log('Response status:', response.status);
        
        const data = await response.json();
        console.log('Response data:', data);
        
        if (data.success) {
            currentUsers = data.data.users;
            displayUsers(currentUsers);
            updateStats(data.data);
            console.log('Users loaded successfully:', currentUsers.length);
        } else {
            console.error('API Error:', data.message);
            showAlert('Failed to load users: ' + data.message, 'error');
        }
    } catch (error) {
        console.error('Error loading users:', error);
        showAlert('Error loading users. Please check your connection.', 'error');
    } finally {
        hideLoading();
    }
}

// Search users
async function searchUsers() {
    const searchTerm = document.getElementById('searchInput').value.trim();
    
    if (!searchTerm) {
        loadAllUsers();
        return;
    }
    
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/admin/all?search=${encodeURIComponent(searchTerm)}`);
        const data = await response.json();
        
        if (data.success) {
            currentUsers = data.data.users;
            displayUsers(currentUsers);
            updateStats(data.data);
        } else {
            showAlert('Search failed: ' + data.message, 'error');
        }
    } catch (error) {
        console.error('Error searching users:', error);
        showAlert('Search error. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Update statistics
function updateStats(data) {
    document.getElementById('totalUsers').textContent = data.total || currentUsers.length;
    
    // Count online users (available status)
    const onlineUsers = currentUsers.filter(user => user.status === 'available').length;
    document.getElementById('onlineUsers').textContent = onlineUsers;
    
    document.getElementById('recentResets').textContent = resetCount;
}

// Display users in grid
function displayUsers(users) {
    const container = document.getElementById('usersContainer');
    
    if (users.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #6c757d;">
                <i class="fas fa-users" style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;"></i>
                <h3>No users found</h3>
                <p>Try adjusting your search criteria or load all users.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = users.map(user => createUserCard(user)).join('');
    
    // Add event listeners to all buttons after creating the cards
    attachEventListeners();
}

// Create user card HTML
function createUserCard(user) {
    const statusClass = getStatusClass(user.status);
    const joinDate = new Date(user.createdAt).toLocaleDateString();
    
    return `
        <div class="user-card">
            <div class="user-info">
                <h3><i class="fas fa-user"></i> ${user.name}</h3>
                <div class="user-details">
                    <div class="user-detail">
                        <i class="fas fa-envelope"></i>
                        <span>${user.email}</span>
                    </div>
                    <div class="user-detail">
                        <i class="fas fa-phone"></i>
                        <span>${user.phoneNumber}</span>
                    </div>
                    <div class="user-detail">
                        <i class="fas fa-id-card"></i>
                        <span>${user.userId}</span>
                    </div>
                    <div class="user-detail">
                        <i class="fas fa-calendar"></i>
                        <span>Joined: ${joinDate}</span>
                    </div>
                    <div class="user-detail">
                        <i class="fas fa-circle"></i>
                        <span class="status-badge ${statusClass}">${user.status}</span>
                    </div>
                </div>
                
                <div class="reset-form" id="resetForm-${user._id}" style="display: none;">
                    <div class="form-group">
                        <label for="newPassword-${user._id}">
                            <i class="fas fa-lock"></i> New Password
                        </label>
                        <input type="password" 
                               id="newPassword-${user._id}" 
                               class="form-control" 
                               placeholder="Enter new password (min 6 characters)"
                               minlength="6">
                    </div>
                    <div class="form-group">
                        <label for="confirmPassword-${user._id}">
                            <i class="fas fa-lock"></i> Confirm Password
                        </label>
                        <input type="password" 
                               id="confirmPassword-${user._id}" 
                               class="form-control" 
                               placeholder="Confirm new password">
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button data-action="reset" data-user-id="${user._id}" data-user-email="${user.email}"
                                class="btn btn-danger" style="flex: 1;">
                            <i class="fas fa-key"></i> Reset Password
                        </button>
                        <button data-action="cancel" data-user-id="${user._id}"
                                class="btn" style="background: #6c757d; color: white; flex: 1;">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    </div>
                </div>
                
                <button data-action="show-form" data-user-id="${user._id}"
                        id="resetBtn-${user._id}"
                        class="btn btn-danger" 
                        style="width: 100%; margin-top: 15px;">
                    <i class="fas fa-key"></i> Reset Password
                </button>
            </div>
        </div>
    `;
}

// Get status CSS class
function getStatusClass(status) {
    switch (status) {
        case 'available':
            return 'status-available';
        case 'busy':
        case 'dnd':
            return 'status-busy';
        case 'away':
            return 'status-away';
        default:
            return 'status-available';
    }
}

// Show reset password form
function showResetForm(userId) {
    console.log('Show reset form called for userId:', userId);
    const form = document.getElementById(`resetForm-${userId}`);
    const button = document.getElementById(`resetBtn-${userId}`);
    
    console.log('Form element:', form);
    console.log('Button element:', button);
    
    if (form && button) {
        form.style.display = 'block';
        button.style.display = 'none';
        
        // Focus on password input
        const passwordInput = document.getElementById(`newPassword-${userId}`);
        if (passwordInput) {
            passwordInput.focus();
        }
        console.log('Reset form shown successfully');
    } else {
        console.error('Could not find form or button elements for userId:', userId);
    }
}

// Cancel reset password
function cancelReset(userId) {
    const form = document.getElementById(`resetForm-${userId}`);
    const button = document.getElementById(`resetBtn-${userId}`);
    
    form.style.display = 'none';
    button.style.display = 'block';
    
    // Clear form fields
    document.getElementById(`newPassword-${userId}`).value = '';
    document.getElementById(`confirmPassword-${userId}`).value = '';
}

// Reset user password
async function resetPassword(userId, userEmail) {
    console.log('Reset password called for:', userId, userEmail);
    
    const newPassword = document.getElementById(`newPassword-${userId}`).value;
    const confirmPassword = document.getElementById(`confirmPassword-${userId}`).value;
    
    console.log('Password values:', { newPassword: newPassword ? 'SET' : 'EMPTY', confirmPassword: confirmPassword ? 'SET' : 'EMPTY' });
    
    // Validation
    if (!newPassword || !confirmPassword) {
        showAlert('Please fill in both password fields.', 'error');
        return;
    }
    
    if (newPassword.length < 6) {
        showAlert('Password must be at least 6 characters long.', 'error');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showAlert('Passwords do not match.', 'error');
        return;
    }
    
    // Confirm action
    const user = currentUsers.find(u => u._id === userId);
    console.log('Found user for reset:', user);
    
    if (!confirm(`Are you sure you want to reset the password for ${user.name} (${user.email})?`)) {
        return;
    }
    
    // Show loading state
    const resetBtn = document.querySelector(`#resetForm-${userId} .btn-danger`);
    const originalText = resetBtn.innerHTML;
    resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
    resetBtn.disabled = true;
    
    try {
        const requestUrl = `${API_BASE_URL}/admin/reset-password`;
        const requestBody = {
            identifier: userEmail,
            newPassword: newPassword
        };
        
        console.log('Making reset request to:', requestUrl);
        console.log('Request body:', requestBody);
        
        const response = await fetch(requestUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('Reset response status:', response.status);
        const data = await response.json();
        console.log('Reset response data:', data);
        
        if (data.success) {
            showAlert(`Password reset successfully for ${user.name}!`, 'success');
            cancelReset(userId);
            resetCount++;
            updateStats({ total: currentUsers.length });
        } else {
            console.error('Reset failed:', data.message);
            showAlert('Password reset failed: ' + data.message, 'error');
        }
    } catch (error) {
        console.error('Error resetting password:', error);
        showAlert('Error resetting password. Please try again.', 'error');
    } finally {
        // Restore button state
        resetBtn.innerHTML = originalText;
        resetBtn.disabled = false;
    }
}

// Generate random password
function generatePassword(length = 8) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

// Add generate password button functionality (can be added to UI later)
function fillGeneratedPassword(userId) {
    const newPassword = generatePassword();
    document.getElementById(`newPassword-${userId}`).value = newPassword;
    document.getElementById(`confirmPassword-${userId}`).value = newPassword;
}
