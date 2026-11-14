@echo off
chcp 65001 >nul
net session >nul 2>&1
if errorlevel 1 (
  echo 需要管理员权限：请右键本文件，选择“以管理员身份运行”
  pause
  exit /b 1
)
schtasks /end /tn "POS-Server" >nul 2>&1
schtasks /delete /f /tn "POS-Server"
echo 已移除开机自启
pause