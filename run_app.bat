@echo off
chcp 65001 > nul
cls
echo ======================================================================
echo           ⚡ 中級維修電工技能測試刷題系統 (2026最新版) ⚡
echo ======================================================================
echo.

:: 獲取電腦的區域網路 IP
for /f "tokens=4" %%a in ('route print ^| findstr 0.0.0.0.*0.0.0.0 ^| findstr /v "255.255.255.255"') do (
    set LOCAL_IP=%%a
)

echo [電腦端使用]
echo   瀏覽器即將自動開啟：http://localhost:8000
echo.
echo [手機端使用] (手機與電腦連接同一個 Wi-Fi 或手機開熱點)
if defined LOCAL_IP (
    echo   👉 請用手機 Safari 或 Chrome 瀏覽器打開：
    echo      http://%LOCAL_IP%:8000
) else (
    echo   👉 請在電腦終端機輸入 ipconfig 查看 IPv4 位址，
    echo      然後在手機瀏覽器輸入：http://[你的電腦IP]:8000
)
echo.
echo [提示] 
echo   1. 可以在手機瀏覽器點選「加入主畫面」，即可像 App 一樣全螢幕刷題！
echo   2. 若要停止服務，請直接關閉此視窗或按下 Ctrl + C。
echo ======================================================================
echo.

start "" "http://localhost:8000"
python -m http.server 8000 --bind 0.0.0.0
if %errorlevel% neq 0 (
    echo.
    echo 啟動 Python 服務失敗，正在直接以離線模式打開 index.html...
    start "" "index.html"
)
pause
