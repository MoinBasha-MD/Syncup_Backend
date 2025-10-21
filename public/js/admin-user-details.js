// Admin User Details Page JavaScript
console.log('Admin user details script loaded from external file');

// Check if all required elements exist on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded - checking elements...');
    
    // Check for required elements
    const userIdElement = document.querySelector('[data-user-id]');
    const statusModal = document.getElementById('statusModal');
    const statusSelect = document.getElementById('statusSelect');
    const notificationModal = document.getElementById('notificationModal');
    
    console.log('User ID element:', userIdElement);
    console.log('Status modal:', statusModal);
    console.log('Status select:', statusSelect);
    console.log('Notification modal:', notificationModal);
    
    if (userIdElement) {
        console.log('User ID:', userIdElement.getAttribute('data-user-id'));
    } else {
        console.error('User ID element not found!');
    }
});

let showingSensitiveData = false;

// Toggle sensitive data visibility
function toggleSensitiveData() {
    console.log('Toggle sensitive data clicked');
    showingSensitiveData = !showingSensitiveData;
    
    const emailMasked = document.getElementById('emailMasked');
    const emailFull = document.getElementById('emailFull');
    const phoneMasked = document.getElementById('phoneMasked');
    const phoneFull = document.getElementById('phoneFull');
    const toggleIcon = document.getElementById('toggleIcon');
    const toggleText = document.getElementById('toggleText');
    
    if (showingSensitiveData) {
        emailMasked.style.display = 'none';
        emailFull.style.display = 'inline';
        phoneMasked.style.display = 'none';
        phoneFull.style.display = 'inline';
        toggleIcon.className = 'fas fa-eye-slash';
        toggleText.textContent = 'Hide Full';
    } else {
        emailMasked.style.display = 'inline';
        emailFull.style.display = 'none';
        phoneMasked.style.display = 'inline';
        phoneFull.style.display = 'none';
        toggleIcon.className = 'fas fa-eye';
        toggleText.textContent = 'Show Full';
    }
}

// Toggle user status (active/inactive)
async function toggleStatus() {
    console.log('Toggle status clicked');
    
    // Get user ID from page
    const userIdElement = document.querySelector('[data-user-id]');
    console.log('User ID element found:', userIdElement);
    
    const userId = userIdElement?.getAttribute('data-user-id');
    console.log('Extracted user ID:', userId);
    
    if (!userId) {
        console.error('User ID not found - element or attribute missing');
        alert('Error: User ID not found. Please refresh the page and try again.');
        return;
    }
    
    if (!confirm('Are you sure you want to toggle this user status?')) {
        console.log('User cancelled toggle operation');
        return;
    }
    
    const toggleBtn = document.getElementById('toggleStatusBtn');
    if (toggleBtn) {
        toggleBtn.disabled = true;
        toggleBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Processing...';
    }
    
    try {
        const url = `/admin/users/${userId}/toggle-status`;
        console.log('Sending toggle request to:', url);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        
        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Toggle response:', data);
        
        if (data.success) {
            alert(data.message || 'User status updated successfully');
            location.reload();
        } else {
            alert(data.message || 'Failed to update user status');
        }
    } catch (error) {
        console.error('Toggle error details:', {
            message: error.message,
            stack: error.stack,
            userId: userId
        });
        alert(`Error updating user status: ${error.message}`);
    } finally {
        if (toggleBtn) {
            toggleBtn.disabled = false;
            toggleBtn.innerHTML = '<i class="fas fa-power-off me-2"></i>Toggle Status';
        }
    }
}

// Show status modal
function showStatusModal() {
    console.log('Show status modal clicked');
    const modal = document.getElementById('statusModal');
    if (modal) {
        modal.style.display = 'flex';
        console.log('Modal displayed');
    } else {
        console.error('Status modal not found!');
        alert('Error: Status modal not found');
    }
}

// Close status modal
function closeStatusModal() {
    console.log('Close status modal');
    const modal = document.getElementById('statusModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Set user status
async function setStatus() {
    console.log('Set status clicked');
    
    const userIdElement = document.querySelector('[data-user-id]');
    const userId = userIdElement?.getAttribute('data-user-id');
    
    if (!userId) {
        console.error('User ID not found');
        alert('Error: User ID not found. Please refresh the page and try again.');
        return;
    }
    
    const statusSelect = document.getElementById('statusSelect');
    const customStatusInput = document.getElementById('customStatus');
    
    if (!statusSelect || !customStatusInput) {
        console.error('Status form elements not found');
        alert('Error: Form elements not found');
        return;
    }
    
    const status = statusSelect.value;
    const customStatus = customStatusInput.value.trim();
    
    console.log('Status data:', { status, customStatus, userId });
    
    try {
        const url = `/admin/users/${userId}/set-status`;
        console.log('Setting status at:', url);
        
        const res = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ status, customStatus })
        });
        
        console.log('Set status response status:', res.status);
        
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        const data = await res.json();
        console.log('Set status response data:', data);
        
        if (data.success) {
            alert(data.message || 'Status updated successfully');
            closeStatusModal();
            location.reload();
        } else {
            alert(data.message || 'Failed to update status');
        }
    } catch (error) {
        console.error('Set status error details:', {
            message: error.message,
            stack: error.stack,
            userId: userId,
            status: status,
            customStatus: customStatus
        });
        alert(`Error setting status: ${error.message}`);
    }
}

// Show notification modal
function showNotificationModal() {
    console.log('Show notification modal clicked');
    const modal = document.getElementById('notificationModal');
    if (modal) {
        modal.style.display = 'flex';
        console.log('Notification modal displayed');
    } else {
        console.error('Notification modal not found!');
        alert('Error: Notification modal not found');
    }
}

// Close notification modal
function closeNotificationModal() {
    console.log('Close notification modal');
    const modal = document.getElementById('notificationModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Send push notification
async function sendNotification() {
    console.log('Send notification clicked');
    
    const userId = document.querySelector('[data-user-id]')?.getAttribute('data-user-id');
    if (!userId) {
        console.error('User ID not found');
        alert('Error: User ID not found');
        return;
    }
    
    const title = document.getElementById('notifTitle').value;
    const message = document.getElementById('notifMessage').value;
    const type = document.getElementById('notifType').value;
    
    if (!title || !message) {
        alert('Please fill all fields');
        return;
    }
    
    try {
        console.log('Sending notification:', { title, message, type });
        const res = await fetch(`/admin/users/${userId}/send-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, message, type })
        });
        
        const data = await res.json();
        console.log('Send notification response:', data);
        
        if (data.success) {
            alert(data.message);
            closeNotificationModal();
            document.getElementById('notificationForm').reset();
        } else {
            alert(data.message);
        }
    } catch (error) {
        console.error('Send notification error:', error);
        alert('Error sending notification');
    }
}

console.log('All functions defined successfully');
