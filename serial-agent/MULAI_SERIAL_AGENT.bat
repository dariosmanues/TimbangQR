@echo off
setlocal
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo File .env dibuat. Edit SERIAL_INGEST_URL, SERIAL_API_KEY, dan SERIAL_PORT terlebih dahulu.
  notepad .env
  pause
  exit /b 0
)
if not exist node_modules (
  echo Menginstal dependency Serial Agent...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node server.mjs
pause
