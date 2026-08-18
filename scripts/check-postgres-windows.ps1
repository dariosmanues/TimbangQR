$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root ".env.example") $envFile
}

$databaseLine = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $databaseLine) {
  Write-Host "DATABASE_URL tidak ditemukan di .env." -ForegroundColor Red
  exit 1
}

$databaseUrl = $databaseLine.Substring("DATABASE_URL=".Length).Trim()
try {
  $uri = [System.Uri]$databaseUrl
  $hostName = $uri.Host
  $port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
} catch {
  Write-Host "Format DATABASE_URL tidak valid: $databaseUrl" -ForegroundColor Red
  exit 1
}

$client = New-Object System.Net.Sockets.TcpClient
try {
  $task = $client.ConnectAsync($hostName, $port)
  if (-not $task.Wait(3000) -or -not $client.Connected) {
    throw "timeout"
  }
  Write-Host "PostgreSQL terdeteksi pada ${hostName}:${port}." -ForegroundColor Green
  exit 0
} catch {
  Write-Host "PostgreSQL belum aktif pada ${hostName}:${port}." -ForegroundColor Red
  Write-Host "Pasang PostgreSQL native, pastikan servicenya berjalan, lalu jalankan SIAPKAN_DATABASE_WINDOWS.bat." -ForegroundColor Yellow
  exit 1
} finally {
  $client.Dispose()
}
