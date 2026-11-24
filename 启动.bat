@echo off
cd /d "%~dp0"
title 算法学习智能体 - 本地预览

rem 上次的服务还开着的话，先关掉它（8123 是本项目专用端口）
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8123" ^| findstr "LISTENING"') do (
  echo 发现旧的服务进程 %%a，正在关闭...
  taskkill /f /pid %%a >nul 2>nul
  ping -n 2 127.0.0.1 >nul
)

python serve.py
if not errorlevel 1 goto end

py -3 serve.py
if not errorlevel 1 goto end

echo.
echo 没有找到可用的 Python，改用离线版打开...
start "" "算法学习智能体-离线版.html"
pause

:end