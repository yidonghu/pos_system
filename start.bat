@echo off
chcp 65001 >nul
cd /d "%~dp0"
title POS 收银系统

where java >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Java，请先安装 JDK 17
  pause
  exit /b 1
)

if not exist "backend\target\pos.jar" (
  echo 首次运行，正在构建程序...
  where mvn >nul 2>nul
  if errorlevel 1 (
    echo [错误] 缺少 backend\target\pos.jar，且未安装 Maven
    pause
    exit /b 1
  )
  call mvn -q -f backend\pom.xml -DskipTests package
  if errorlevel 1 (
    echo 构建失败，请检查网络与 Maven
    pause
    exit /b 1
  )
)

if not exist "data" mkdir data
if not exist "backup" mkdir backup

netstat -ano | findstr "LISTENING" | findstr ":8080" >nul
if not errorlevel 1 (
  echo [提示] 8080 端口已被占用，服务应该已经在运行，不再重复启动。
  echo        浏览器直接访问 http://localhost:8080
  echo        要重启请先运行「停止服务.bat」，再回来运行本文件。
  start "" powershell -WindowStyle Hidden -Command "Start-Sleep 1; Start-Process 'http://localhost:8080/'"
  pause
  exit /b 0
)

echo ==============================================
echo  服务启动中，请勿关闭本窗口
echo.
echo  电脑 http   http://localhost:8080
echo  电脑 https  https://localhost:8443
echo  手机访问    https://本机IP:8443/pos
echo              （扫后台「设置」页二维码即可，http 地址手机不能调摄像头）
echo.
echo  关闭窗口或按 Ctrl+C 即停止服务
echo ==============================================
start "" powershell -WindowStyle Hidden -Command "Start-Sleep 6; Start-Process 'http://localhost:8080/'"
java -jar backend\target\pos.jar
echo.
echo 服务已退出。
pause
