@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8080" ^| findstr LISTENING') do (
  set "P=%%p"
  if not "!P!"=="0" (
    taskkill /PID !P! /F >nul 2>nul
    set FOUND=1
  )
)
if "!FOUND!"=="1" (
  echo 已停止占用 8080 端口的服务进程
) else (
  echo 没有发现正在运行的服务
)
timeout /t 2 >nul