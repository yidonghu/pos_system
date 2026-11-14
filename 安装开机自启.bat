@echo off
chcp 65001 >nul
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo 需要管理员权限：请右键本文件，选择“以管理员身份运行”
  pause
  exit /b 1
)
schtasks /create /f /tn "POS-Server" /sc ONSTART /ru SYSTEM /rl HIGHEST /tr "\"%~dp0start-service.bat\""
if errorlevel 1 (
  echo 创建失败，请检查 Java 是否已安装
  pause
  exit /b 1
)
schtasks /run /tn "POS-Server"
echo.
echo 已安装：开机自动启动（计划任务名 POS-Server）
echo 服务地址：http://localhost:8080
pause