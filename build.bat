@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 开始构建…
call mvn -q -f backend\pom.xml -DskipTests package
if errorlevel 1 (
  echo 构建失败
) else (
  echo 构建完成: backend\target\pos.jar
)
pause