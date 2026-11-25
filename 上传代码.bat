@echo off
chcp 936 >nul
cd /d "%~dp0"
title 保存进度

echo [1/3] 保存修改...
git add -A
git commit -m "存档 %date% %time%"
if errorlevel 1 echo       没有新的修改，跳过提交。

echo.
echo [2/3] 检查远程仓库...
git remote | findstr . >nul
if errorlevel 1 (
  echo       还没绑定远程仓库，本次只保存在本机。
  echo       绑定方法见 README 的「多人协作」一节。
  goto done
)

echo [3/3] 推送当前分支...
git push -u origin HEAD
if errorlevel 1 (
  echo.
  echo       推送失败，常见原因：
  echo       1. 没登录 GitHub —— 再运行一次，在弹出的窗口里登录
  echo       2. 网络连不上 GitHub —— 开代理，或改用 Gitee
  echo       3. 当前在 main 分支且开了保护 —— 先开分支：git checkout -b feat/姓名-功能
  echo       把上面的报错截图发给 AI 即可。
) else (
  echo.
  echo       推送成功。如果这是在功能分支上，去网页开 PR 合并。
)

:done
echo.
echo 完成。按任意键关闭。
pause >nul