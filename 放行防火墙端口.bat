@echo off
chcp 65001 >nul
title 放行 POS 端口（需管理员）
net session >nul 2>&1
if errorlevel 1 (
    echo 请右键此文件，选择“以管理员身份运行”。
    pause
    exit /b 1
)
echo 正在放行 TCP 8080（http）与 8443（https）...
netsh advfirewall firewall delete rule name="POS-Server 8080" >nul 2>&1
netsh advfirewall firewall delete rule name="POS-Server 8443" >nul 2>&1
netsh advfirewall firewall add rule name="POS-Server 8080" dir=in action=allow protocol=TCP localport=8080 profile=any
netsh advfirewall firewall add rule name="POS-Server 8443" dir=in action=allow protocol=TCP localport=8443 profile=any
echo.
echo 完成。手机扫码请用 https://本机IP:8443/pos
pause
