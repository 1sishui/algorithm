@echo off
cd /d "%~dp0"
title 算法学习智能体 - 本地预览

python serve.py
if not errorlevel 1 goto end

py -3 serve.py
if not errorlevel 1 goto end

echo.
echo 没有找到可用的 Python，改用离线版打开...
start "" "算法学习智能体-离线版.html"
pause

:end