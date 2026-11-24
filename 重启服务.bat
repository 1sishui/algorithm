@echo off
cd /d "%~dp0"
title 重启算法学习智能体服务

echo 正在关闭占用 8123 端口的旧服务...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8123" ^| findstr "LISTENING"') do (
  taskkill /f /pid %%a >nul 2>nul
)
ping -n 2 127.0.0.1 >nul

echo 正在启动新版服务...
python serve.py
if not errorlevel 1 goto end
py -3 serve.py
if not errorlevel 1 goto end

echo.
echo 没有找到可用的 Python，改用离线版打开...
start "" "算法学习智能体-离线版.html"
pause

:end