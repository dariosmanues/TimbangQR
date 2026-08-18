@echo off
setlocal
title Siapkan PostgreSQL TimbangQR
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-postgres-windows.ps1"
if errorlevel 1 (
  echo.
  echo Penyiapan database gagal. Periksa pesan di atas.
  pause
  exit /b 1
)
echo.
pause
