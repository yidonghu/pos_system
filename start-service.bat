@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "backend\target\pos.jar" (
  echo 未找到 pos.jar，先构建...
  call build.bat
)
:loop
echo [%date% %time%] 启动收银服务...
java -jar backend\target\pos.jar
echo 服务已退出，5 秒后自动重启（按 Ctrl+C 可停止）
timeout /t 5 /nobreak >nul
goto loop