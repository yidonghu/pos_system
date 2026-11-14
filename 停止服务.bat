@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 停止 POS 服务
echo 正在查找占用 8080 / 8443 的 Java 进程...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=@(8080,8443); $pids=@(); foreach($p in $ports){ $pids += (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess) }; $pids = $pids | Sort-Object -Unique; if(-not $pids){ Write-Host '没有服务在运行（端口空闲）。' } else { foreach($id in $pids){ $proc = Get-Process -Id $id -ErrorAction SilentlyContinue; if($proc -and $proc.ProcessName -in @('java','javaw')){ Stop-Process -Id $id -Force; Write-Host ('已停止 java 进程 PID ' + $id) } else { Write-Host ('端口被非 Java 进程占用，未处理: PID ' + $id + ' (' + ($proc.ProcessName) + ')') } } }"
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "if((Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue)){ Write-Host '8080 仍被占用' } else { Write-Host '8080 已释放' }"
echo.
pause
