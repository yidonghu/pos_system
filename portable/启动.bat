@echo off
chcp 65001 >nul
cd /d "%~dp0"
title POS 收银系统 绿色版

set "JAVA_BIN=java"
if exist "%~dp0jre\bin\java.exe" set "JAVA_BIN=%~dp0jre\bin\java.exe"

"%JAVA_BIN%" -version >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Java 17。
  echo        装一个 JDK 17，或把 jre 文件夹放到本目录下再运行。
  pause
  exit /b 1
)

if not exist "%~dp0data" mkdir "%~dp0data"
if not exist "%~dp0backup" mkdir "%~dp0backup"

echo ==============================================
echo   本机收银:  http://localhost:8080/pos
echo   管理后台:  http://localhost:8080/admin
echo   手机收银:  https://本机IP:8443/pos  ^(扫码必须用 https^)
echo   关闭本窗口或按 Ctrl+C 停止服务
echo ==============================================

start "" powershell -WindowStyle Hidden -Command "Start-Sleep 5; Start-Process 'http://localhost:8080/'"

"%JAVA_BIN%" -jar "%~dp0pos.jar"
pause