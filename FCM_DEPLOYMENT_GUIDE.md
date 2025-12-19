# FCM Deployment Guide for Production Server

## Overview
The Firebase service account credentials file (`firebase-service-account.json`) is protected by `.gitignore` for security reasons and will NOT be pushed to GitHub. You need to manually upload it to your production server.

---

## Deployment Steps

### Step 1: Pull Code from GitHub on Production Server

```bash
cd /path/to/backend
git pull origin main
```

### Step 2: Upload Firebase Service Account File

You have **two options** to get the Firebase config file on the server:

#### **Option A: Manual Upload via SCP/SFTP (Recommended)**

From your local machine, upload the file to the server:

```bash
# Using SCP
scp E:\Backend\config\firebase-service-account.json user@45.129.86.96:/path/to/backend/config/

# Or use FileZilla, WinSCP, or any SFTP client
```

#### **Option B: Create File Directly on Server**

1. SSH into your production server:
   ```bash
   ssh user@45.129.86.96
   ```

2. Navigate to backend config folder:
   ```bash
   cd /path/to/backend/config
   ```

3. Create the file:
   ```bash
   nano firebase-service-account.json
   ```

4. Copy-paste the contents from your local file and save (Ctrl+X, Y, Enter)

---

## Step 3: Verify File Permissions

Make sure the file has correct permissions:

```bash
chmod 600 config/firebase-service-account.json
```

This ensures only the owner can read/write the file.

---

## Step 4: Verify Configuration

Check that the file exists and is readable:

```bash
ls -la config/firebase-service-account.json
cat config/firebase-service-account.json
```

---

## Step 5: Restart Backend Server

```bash
# If using PM2
pm2 restart backend

# If using systemd
sudo systemctl restart backend

# Or manually
npm start
```

---

## Step 6: Verify FCM Initialization

Check the server logs to confirm FCM initialized successfully:

```bash
# If using PM2
pm2 logs backend

# Look for these messages:
# 🔔 [FCM] Initializing Firebase Admin SDK...
# ✅ [FCM] Firebase Admin SDK initialized successfully
# ✅ [FCM] Project: syncup-c45fb
```

---

## Troubleshooting

### Error: "Cannot find module '../config/firebase-service-account.json'"

**Solution:** The file is missing. Upload it using Step 2.

### Error: "EACCES: permission denied"

**Solution:** Fix file permissions:
```bash
chmod 600 config/firebase-service-account.json
chown $USER:$USER config/firebase-service-account.json
```

### Error: "Invalid service account"

**Solution:** The file content is corrupted. Re-upload the file from your local machine.

---

## Security Notes

✅ **DO NOT** commit `firebase-service-account.json` to Git
✅ **DO NOT** share this file publicly
✅ Keep file permissions restricted (600)
✅ Only upload via secure channels (SCP/SFTP)
✅ Rotate credentials if exposed

---

## File Location

- **Local Development:** `E:\Backend\config\firebase-service-account.json`
- **Production Server:** `/path/to/backend/config/firebase-service-account.json`

---

## Alternative: Environment Variables (Advanced)

If you prefer not to upload the file, you can use environment variables instead. This requires modifying the FCM service to read credentials from environment variables rather than a file.

Contact the development team if you need this implementation.

---

**Last Updated:** December 19, 2025
