@echo off
chcp 65001 >nul
title A股集合竞价模拟器
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\hqchart" (
  echo 首次运行，正在安装依赖，请稍候...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试
    pause
    exit /b 1
  )
)

echo.
echo ==========================================
echo   A股集合竞价模拟器 正在启动...
echo   浏览器会自动打开；如未打开请访问下方地址
echo   关闭本窗口即可停止模拟器
echo ==========================================
echo.
call npx vite --open
pause
