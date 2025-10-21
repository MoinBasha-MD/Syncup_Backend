@echo off
echo ========================================
echo   SyncUp Production Cleanup Script
echo ========================================
echo.
echo Removing admin panels and old dashboards...
echo.

REM Remove admin route files
echo [1/4] Removing admin route files...
if exist "routes\adminRoutes.js" del /f /q "routes\adminRoutes.js"
if exist "routes\adminUsersRoutes.js" del /f /q "routes\adminUsersRoutes.js"
if exist "routes\adminContentRoutes.js" del /f /q "routes\adminContentRoutes.js"
if exist "routes\adminGroupsRoutes.js" del /f /q "routes\adminGroupsRoutes.js"
if exist "routes\adminAdvancedRoutes.js" del /f /q "routes\adminAdvancedRoutes.js"
if exist "routes\reactAdminRoutes.js" del /f /q "routes\reactAdminRoutes.js"
if exist "routes\agentDashboardRoutes.js" del /f /q "routes\agentDashboardRoutes.js"
echo    ✓ Admin route files removed

REM Remove admin public directories
echo [2/4] Removing admin public directories...
if exist "public\admin" rmdir /s /q "public\admin"
if exist "public\agent-dashboard" rmdir /s /q "public\agent-dashboard"
if exist "public\agent-dashboard-v2" rmdir /s /q "public\agent-dashboard-v2"
echo    ✓ Admin directories removed

REM Remove admin views
echo [3/4] Removing admin views...
if exist "views\admin" rmdir /s /q "views\admin"
if exist "views\layouts" rmdir /s /q "views\layouts"
echo    ✓ Admin views removed

REM Remove admin middleware
echo [4/4] Removing admin middleware...
if exist "middleware\adminAuth.js" del /f /q "middleware\adminAuth.js"
if exist "middleware\adminMiddleware.js" del /f /q "middleware\adminMiddleware.js"
echo    ✓ Admin middleware removed

echo.
echo ========================================
echo   Cleanup completed successfully!
echo ========================================
echo.
echo The following items have been removed:
echo   • All admin route files
echo   • Old dashboard files
echo   • Admin public directories
echo   • Admin view templates
echo   • Admin middleware files
echo.
echo Your codebase is now clean for production!
echo.
pause
