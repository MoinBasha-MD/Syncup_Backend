# Backend Maya Name Fixes

## Files to Update:

### 1. models/aiAssistantModel.js (Line 24)
```javascript
// CHANGE FROM:
aiName: {
  type: String,
  default: 'Diya',
  maxlength: 50
},

// CHANGE TO:
aiName: {
  type: String,
  default: 'Maya',
  maxlength: 50
},
```

### 2. services/aiMessageService.js (Line 16)
```javascript
// CHANGE FROM:
static async initializeAI(userId, aiName = 'Diya') {

// CHANGE TO:
static async initializeAI(userId, aiName = 'Maya') {
```

### 3. services/aiInitializationService.js (Line 34)
```javascript
// CHANGE FROM:
aiName: preferences.aiName || 'Diya',

// CHANGE TO:
aiName: preferences.aiName || 'Maya',
```

## After Making Changes:
1. Restart your backend server
2. Test with "@TesterTwo coffee" 
3. Should now see "🤖 AI Message sent: Maya → Maya"

## Why TesterTwo is Offline:
- This is normal behavior - they're not connected
- Message will be delivered when they open the app
- The "User not found or offline" message is expected
