@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "NAME=POS收银绿色版"
set "DIST=dist"
set "OUT=%DIST%\%NAME%"

where java >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 java，请先安装 JDK 17
  pause
  exit /b 1
)

if not exist "backend\target\pos.jar" (
  echo 正在编译后端，第一次会比较慢…
  call mvn -q -f backend\pom.xml -DskipTests package
  if errorlevel 1 (
    echo [错误] 编译失败，请检查 Maven 与网络
    pause
    exit /b 1
  )
)

if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%"

copy "backend\target\pos.jar" "%OUT%\pos.jar" >nul
xcopy "web" "%OUT%\web" /E /I /Y >nul
copy "portable\启动.bat" "%OUT%\启动.bat" >nul
copy "portable\停止服务.bat" "%OUT%\停止服务.bat" >nul
copy "portable\使用说明.txt" "%OUT%\使用说明.txt" >nul

where jlink >nul 2>nul
if errorlevel 1 goto skipjre
echo 正在生成精简 Java 运行时 jre（约 60-90 秒）…
jlink --add-modules java.se,jdk.unsupported,jdk.crypto.ec --strip-debug --no-header-files --no-man-pages --compress=2 --output "%OUT%\jre"
if errorlevel 1 echo [提示] jlink 生成失败，绿色版将使用本机已安装的 Java
goto pack

:skipjre
echo [提示] 没找到 jlink，绿色版不内置 jre，将在目标电脑使用已安装的 Java 17

:pack
powershell -NoProfile -Command "if (Test-Path '%DIST%\%NAME%.zip') { Remove-Item '%DIST%\%NAME%.zip' -Force }; Compress-Archive -Path '%OUT%\*' -DestinationPath '%DIST%\%NAME%.zip' -Force"

echo.
echo 打包完成
echo   文件夹: %OUT%
echo   压缩包: %DIST%\%NAME%.zip
echo 拷到任意电脑解压，双击「启动.bat」即可，无需安装。
pause