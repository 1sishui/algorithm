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

echo [3/3] 推送到远程...
git push -u origin main
if errorlevel 1 (
  echo.
  echo       推送失败，常见原因：
  echo       1. 没登录 GitHub —— 再运行一次，在弹出的窗口里登录
  echo       2. 网络连不上 GitHub —— 换网络，或改用 Gitee
  echo       3. 仓库地址不对 —— 运行 git remote -v 检查
  echo       把上面的报错截图发给 AI 即可。
) else (
  echo.
  echo       推送成功，去网页刷新看看。
)

:done
echo.
echo 完成。按任意键关闭。
pause >nul