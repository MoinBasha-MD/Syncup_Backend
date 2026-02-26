@echo off
echo ============================================
echo Backend Status Check
echo ============================================
echo.

echo 1. Checking if backend is running...
curl -s http://45.129.86.96:5000/health
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Backend is NOT running!
    echo Please start backend: cd e:\Backend ^&^& npm start
    pause
    exit /b 1
)
echo.
echo [OK] Backend is running
echo.

echo 2. Checking if user status route exists...
curl -s -o nul -w "HTTP Status: %%{http_code}\n" http://45.129.86.96:5000/api/admin/users/all-with-status
echo.
echo If status is 401: Route exists (needs auth) - GOOD
echo If status is 404: Route NOT found - Backend needs restart
echo.

echo 3. Checking server.js for route registration...
findstr /C:"adminUserStatusRoutes" e:\Backend\server.js
if %errorlevel% neq 0 (
    echo [ERROR] Routes not registered in server.js!
    echo Please check server.js file
) else (
    echo [OK] Routes are registered in server.js
)
echo.

echo 4. Checking if controller file exists...
if exist "e:\Backend\controllers\adminUserStatusController.js" (
    echo [OK] Controller file exists
) else (
    echo [ERROR] Controller file missing!
)
echo.

echo 5. Checking if routes file exists...
if exist "e:\Backend\routes\adminUserStatusRoutes.js" (
    echo [OK] Routes file exists
) else (
    echo [ERROR] Routes file missing!
)
echo.

echo ============================================
echo NEXT STEPS:
echo ============================================
echo.
echo If you see errors above:
echo 1. Stop backend server (Ctrl+C)
echo 2. Run: cd e:\Backend
echo 3. Run: npm start
echo 4. Wait for "Server running" message
echo 5. Refresh admin panel (Ctrl+F5)
echo.
echo If all checks pass but admin panel still shows no users:
echo 1. Check browser console (F12) for errors
echo 2. Verify you're logged in to admin panel
echo 3. Check if users exist in database
echo.
pause
