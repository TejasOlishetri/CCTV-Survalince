@echo off
echo ========================================================
echo  Starting DeepCamera AI Studio (React Dev + Python AI)
echo ========================================================
echo.
echo 1. Launching Python AI Surveillance Engine (Port 5000)...
start "DeepCamera Python AI Backend" cmd /k "python webapp\app.py"

echo 2. Launching React Frontend (npm run dev on Port 5173)...
timeout /t 3 /nobreak >nul
start http://localhost:5173
cd frontend
npm run dev
pause
