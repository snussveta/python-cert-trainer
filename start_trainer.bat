@echo off
chcp 65001 >nul
echo ========================================================
echo   Python Master: CertExam Interactive Trainer (98-381)
echo ========================================================
echo.
echo Запуск локального веб-сервера...
start "" "http://localhost:8080"
python -m http.server 8080
pause
