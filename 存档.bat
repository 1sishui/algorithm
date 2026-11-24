@echo off
chcp 936 >nul
cd /d "%~dp0"
title 保存进度

echo 正在保存本次修改...
git add -A
git commit -m "存档 %date% %time%"
if errorlevel 1 (
  echo.
  echo 没有新的修改，不用存档。
)

git remote | findstr . >nul
if errorlevel 1 (
  echo.
  echo 还没绑定远程仓库，这次只存在本机。
  echo 绑定方法见 README 的「多人协作」一节。
) else (
  echo.
  echo 正在推送到远程仓库...
  git push
  if errorlevel 1 echo 推送失败，检查网络或登录状态。
)

echo.
echo 完成。按任意键关闭。
pause >nul