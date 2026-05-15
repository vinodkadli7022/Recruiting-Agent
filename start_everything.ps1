# start_everything.ps1
Write-Host "🚀 Launching GeniusAI Autonomous Pipeline..." -ForegroundColor Cyan

# 1. Kill any orphans
Get-Process uvicorn, python, node, celery -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Start Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; uvicorn main:app --reload --port 8000"
Write-Host "✅ Backend (8000) starting..." -ForegroundColor Green

# 3. Start Frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"
Write-Host "✅ Frontend (3000) starting..." -ForegroundColor Green

# 4. Start Celery
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; celery -A celery_app worker --loglevel=info --pool=solo"
Write-Host "✅ AI Workers starting..." -ForegroundColor Green

Write-Host "🏁 All systems initiated! Open http://localhost:3000 in 10 seconds." -ForegroundColor Magenta
