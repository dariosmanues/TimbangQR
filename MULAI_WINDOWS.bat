@echo off
setlocal
title TimbangQR PostgreSQL Native - Local Development
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS belum terpasang.
  pause
  exit /b 1
)

if not exist .env copy .env.example .env >nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-postgres-windows.ps1"
if errorlevel 1 (
  echo.
  echo Jalankan SIAPKAN_DATABASE_WINDOWS.bat setelah PostgreSQL terpasang.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Menginstal dependency web...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Menyiapkan schema dan data awal PostgreSQL...
call npm run db:init
if errorlevel 1 (
  echo.
  echo Koneksi database gagal. Periksa DATABASE_URL di .env.
  pause
  exit /b 1
)

if not exist serial-agent\.env copy serial-agent\.env.example serial-agent\.env >nul
if not exist serial-agent\node_modules (
  pushd serial-agent
  echo Menginstal dependency Serial Agent...
  call npm install
  if errorlevel 1 (
    popd
    pause
    exit /b 1
  )
  popd
)

start "TimbangQR Serial Agent" cmd /k "cd /d ""%~dp0serial-agent"" && npm start"
echo Web App: http://localhost:3000
echo Serial Agent: http://127.0.0.1:8787
echo.
call npm run dev
