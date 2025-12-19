# FCM Testing Guide - How to Test Push Notifications

## Overview
This guide will help you test FCM (Firebase Cloud Messaging) notifications in different scenarios:
- ✅ App in foreground (app open)
- ✅ App in background (app minimized)
- ✅ App completely closed (killed from recent apps)

---

## Prerequisites

### 1. Backend Setup
- ✅ Backend server running with FCM initialized
- ✅ Firebase service account file in `config/firebase-service-account.json`
- ✅ Check backend logs for: `✅ [FCM] Firebase Admin SDK initialized successfully`

### 2. Frontend Setup
- ✅ FCM token registered on app startup
- ✅ Background message handler configured
- ✅ Notification permissions granted

---

## Testing Methods

### **Method 1: Using Postman/Thunder Client (Recommended)**

This is the easiest way to test FCM notifications without needing another user.

#### Step 1: Get Your Auth Token

1. Login to your app
2. Copy your authentication token from app storage or login response

#### Step 2: Test Custom Notification

**Endpoint:** `POST http://localhost:5000/api/notifications/test-fcm`

**Headers:**
```
Authorization: Bearer YOUR_AUTH_TOKEN
Content-Type: application/json
```

**Body (Custom Message):**
```json
{
  "title": "🧪 Test Notification",
  "body": "Testing FCM - App should receive this even when closed!",
  "testType": "custom"
}
```

**Body (Wakeup Notification - Silent):**
```json
{
  "testType": "wakeup"
}
```

#### Step 3: Expected Response

```json
{
  "success": true,
  "message": "Test notification sent successfully",
  "details": {
    "userId": "your-user-id",
    "userName": "Your Name",
    "tokensCount": 1,
    "sentCount": 1,
    "testType": "custom"
  }
}
```

---

### **Method 2: Send Message from Another User**

1. Login with User A on one device
2. Login with User B on another device
3. User A sends a message to User B
4. Close User B's app completely
5. User A sends another message
6. User B should receive FCM notification and app should wake up

---

## Testing Scenarios

### ✅ Scenario 1: App in Foreground (App Open)

**What to Test:**
- Send test notification while app is open
- Notification should appear in notification tray
- App should handle the notification data

**Steps:**
1. Open the app
2. Keep it in foreground
3. Send test notification via Postman
4. Check notification appears

**Expected Result:**
- Notification appears in system tray
- App receives notification data via `onMessage` handler

---

### ✅ Scenario 2: App in Background (Minimized)

**What to Test:**
- Send test notification while app is minimized
- Notification should appear in notification tray
- Tapping notification should open the app

**Steps:**
1. Open the app
2. Press Home button (minimize app, don't close it)
3. Send test notification via Postman
4. Check notification appears
5. Tap notification

**Expected Result:**
- Notification appears in system tray
- Tapping notification opens the app
- App receives notification data via `onNotificationOpenedApp` handler

---

### ✅ Scenario 3: App Completely Closed (MOST IMPORTANT)

**What to Test:**
- Send test notification when app is completely killed
- This tests if FCM can wake up the app

**Steps:**
1. Open the app (ensure FCM token is registered)
2. **Close the app completely:**
   - Android: Swipe app away from recent apps
   - iOS: Swipe up and close the app
3. Wait 5 seconds
4. Send test notification via Postman
5. Check your phone

**Expected Result:**
- Notification appears in system tray (even though app is closed)
- Tapping notification opens the app
- App receives notification data via `getInitialNotification` handler

**⚠️ IMPORTANT:**
- This ONLY works with a **release build APK**, NOT in debug mode
- Debug builds won't receive notifications when completely closed
- You need to build and install a release APK to test this

---

## How to Build Release APK for Testing

### Android Release Build

```bash
cd android
./gradlew assembleRelease
```

**Install on device:**
```bash
adb install app/build/outputs/apk/release/app-release.apk
```

**Or use this command from root:**
```bash
cd android && ./gradlew assembleRelease && adb install app/build/outputs/apk/release/app-release.apk
```

---

## Troubleshooting

### ❌ Error: "No FCM tokens registered for this user"

**Solution:**
- Make sure you've logged into the app at least once
- Check that FCM token registration is working
- Verify token is saved in database

**Check in MongoDB:**
```javascript
db.users.findOne({ userId: "your-user-id" }, { fcmTokens: 1 })
```

### ❌ Notification not received when app is closed

**Possible Causes:**
1. **Using debug build** - Debug builds don't support background FCM
   - **Solution:** Build and install release APK

2. **Battery optimization** - Android kills background processes
   - **Solution:** Disable battery optimization for your app in phone settings

3. **FCM token not registered**
   - **Solution:** Open app, login, check backend logs for token registration

4. **Firebase config issue**
   - **Solution:** Verify `firebase-service-account.json` is correct

### ❌ Backend Error: "Cannot find module '../config/firebase-service-account.json'"

**Solution:**
- Make sure `firebase-service-account.json` exists in `config/` folder
- Check file name is exactly: `firebase-service-account.json`

---

## Checking Backend Logs

When you send a test notification, check backend logs for:

```
🧪 [FCM TEST] Sending test notification to User Name (1 tokens)
✅ [FCM TEST] Notification sent - Success: 1, Failed: 0
  ✅ Token 1: Delivered
```

If you see failures:
```
  ❌ Token 1: Failed - Requested entity was not found
```

This means the FCM token is invalid or expired. The app needs to re-register.

---

## Quick Test Checklist

- [ ] Backend server running
- [ ] FCM initialized successfully (check logs)
- [ ] App logged in and FCM token registered
- [ ] Test 1: Notification while app is open ✅
- [ ] Test 2: Notification while app is minimized ✅
- [ ] Test 3: Notification while app is closed (release APK only) ✅
- [ ] Tapping notification opens the app ✅
- [ ] App receives notification data correctly ✅

---

## Example Postman Collection

### 1. Register FCM Token
```
POST http://localhost:5000/api/notifications/register-fcm-token
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "fcmToken": "your-device-fcm-token",
  "platform": "android"
}
```

### 2. Send Test Notification
```
POST http://localhost:5000/api/notifications/test-fcm
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "title": "🧪 FCM Test",
  "body": "Testing push notifications!",
  "testType": "custom"
}
```

### 3. Send Wakeup Notification (Silent)
```
POST http://localhost:5000/api/notifications/test-fcm
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "testType": "wakeup"
}
```

---

## Production Server Testing

When testing on production server (45.129.86.96):

Replace `localhost:5000` with `45.129.86.96:5000` in all endpoints:

```
POST http://45.129.86.96:5000/api/notifications/test-fcm
```

---

## Notes

1. **Debug vs Release:**
   - Debug builds: FCM works when app is open or minimized
   - Release builds: FCM works even when app is completely closed

2. **Network:**
   - Make sure your phone can reach the backend server
   - For localhost testing, phone and computer must be on same network

3. **Permissions:**
   - Ensure notification permissions are granted in phone settings

4. **Battery Optimization:**
   - Disable battery optimization for your app to ensure background delivery

---

**Last Updated:** December 19, 2025
