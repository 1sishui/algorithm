@echo off
chcp 936 >nul
cd /d "%~dp0"
title 跑一遍自测

where node >nul 2>nul
if errorlevel 1 (
  echo 没装 Node，跳过 JS 自测（只跑 Python 部分）
  goto py
)

echo [1/2] JS 自测...
for %%f in (test\*.mjs) do (
  echo   - %%f
  node "%%f"
  if errorlevel 1 goto fail
)
goto py

:py
echo.
echo [2/2] Python 语法检查与单测...
python -m py_compile serve.py server\llm_proxy.py server\luogu_proxy.py
if errorlevel 1 goto fail
python -m unittest discover -s test -p "test_*.py"
if errorlevel 1 goto fail

echo.
echo 全部通过，可以提交了。
pause
exit /b 0

:fail
echo.
echo 有测试没过，先修好再提交。
pause
exit /b 1