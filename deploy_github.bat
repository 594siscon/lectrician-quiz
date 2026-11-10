@echo off
chcp 65001 > nul
cls
echo ========================================================
echo         一鍵部署到 GitHub Pages 雲端託管
echo ========================================================
echo.
echo 請先在 GitHub (https://github.com/new) 建立一個新倉庫 (例如: electrician-quiz)
echo.
set /p REPO_URL="請貼上您的 GitHub 倉庫網址 (例如 https://github.com/594siscon/electrician-quiz.git): "

if "%REPO_URL%"=="" (
    echo [錯誤] 網址不能為空！
    pause
    exit /b
)

echo.
echo 正在設定遠端倉庫...
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

echo 正在推送程式碼到 main 分支...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo  🎉 程式碼已成功推送至 GitHub！
    echo.
    echo  最後一步：開啟 GitHub Pages 網站
    echo  1. 請開啟您的 GitHub 倉庫頁面
    echo  2. 點擊頂部的 [Settings] (設定)
    echo  3. 在左側選單點擊 [Pages]
    echo  4. 在 [Branch] 處選擇 "main" 分支，並點擊 [Save] (儲存)
    echo  5. 稍等約 1 分鐘，GitHub 就會為您生成永久免費的雲端網址！
    echo ========================================================
) else (
    echo.
    echo [提示] 推送失敗，請確認網址是否正確，以及是否已在 GitHub 登入授權。
)
pause

