$ErrorActionPreference = "Stop"

function Find-Psql {
  $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $base = "C:\Program Files\PostgreSQL"
  if (Test-Path $base) {
    $candidates = Get-ChildItem $base -Directory | Sort-Object Name -Descending
    foreach ($dir in $candidates) {
      $candidate = Join-Path $dir.FullName "bin\psql.exe"
      if (Test-Path $candidate) { return $candidate }
    }
  }
  return $null
}

function Read-DotEnv([string]$path) {
  $map = @{}
  foreach ($line in Get-Content $path) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $parts = $line.Split('=', 2)
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $map[$key] = $value
  }
  return $map
}

function SqlLiteral([string]$value) {
  if ($null -eq $value) { return "NULL" }
  return "'" + $value.Replace("'", "''") + "'"
}

function SqlIdentifier([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Identifier PostgreSQL kosong." }
  return '"' + $value.Replace('"', '""') + '"'
}

function Invoke-PsqlScalar([string]$query) {
  $output = @(& $script:psql -h $script:dbHost -p $script:dbPort -U $script:adminUser -d postgres -v ON_ERROR_STOP=1 -tAc $query 2>&1)
  if ($LASTEXITCODE -ne 0) {
    $message = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    throw "Query PostgreSQL gagal:`n$message"
  }

  $lines = @($output | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ -ne "" })
  if ($lines.Count -eq 0) { return "" }
  return ($lines -join "").Trim()
}

function Invoke-PsqlCommand([string]$query, [string]$failureMessage) {
  $output = @(& $script:psql -h $script:dbHost -p $script:dbPort -U $script:adminUser -d postgres -v ON_ERROR_STOP=1 -c $query 2>&1)
  if ($LASTEXITCODE -ne 0) {
    $message = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    throw "$failureMessage`n$message"
  }
}

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root ".env.example") $envFile
  Write-Host ".env dibuat dari .env.example." -ForegroundColor Cyan
}

$values = Read-DotEnv $envFile
$databaseUrl = $values["DATABASE_URL"]
if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
  throw "DATABASE_URL tidak ditemukan atau kosong di .env."
}

try {
  $uri = [System.Uri]$databaseUrl
} catch {
  throw "DATABASE_URL tidak valid. Format contoh: postgresql://user:password@localhost:5432/database"
}

$userInfo = $uri.UserInfo.Split(':', 2)
$appUser = [System.Uri]::UnescapeDataString($userInfo[0])
$appPassword = if ($userInfo.Count -gt 1) { [System.Uri]::UnescapeDataString($userInfo[1]) } else { "" }
$dbName = $uri.AbsolutePath.TrimStart('/')
$dbHost = $uri.Host
$dbPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
$adminUser = if ($values["POSTGRES_ADMIN_USER"]) { $values["POSTGRES_ADMIN_USER"] } else { "postgres" }

if ([string]::IsNullOrWhiteSpace($appUser)) { throw "User PostgreSQL pada DATABASE_URL kosong." }
if ([string]::IsNullOrWhiteSpace($dbName)) { throw "Nama database pada DATABASE_URL kosong." }
if ([string]::IsNullOrWhiteSpace($dbHost)) { throw "Host PostgreSQL pada DATABASE_URL kosong." }

$psql = Find-Psql
if (-not $psql) {
  Write-Host "psql.exe tidak ditemukan." -ForegroundColor Red
  Write-Host "Pasang PostgreSQL untuk Windows terlebih dahulu dan aktifkan Command Line Tools." -ForegroundColor Yellow
  exit 1
}

# Digunakan oleh fungsi helper di atas.
$script:psql = $psql
$script:dbHost = $dbHost
$script:dbPort = $dbPort
$script:adminUser = $adminUser

Write-Host "Menyiapkan database '$dbName' dan user '$appUser' pada ${dbHost}:${dbPort}." -ForegroundColor Cyan
Write-Host "Password yang diminta berikut adalah password akun PostgreSQL '$adminUser', bukan password login aplikasi." -ForegroundColor DarkYellow
$secure = Read-Host "Masukkan password superuser PostgreSQL '$adminUser' (boleh kosong jika instalasi memang tanpa password)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plainAdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

$oldPgPassword = $env:PGPASSWORD
$env:PGPASSWORD = $plainAdminPassword
try {
  $connectionTest = Invoke-PsqlScalar "SELECT 1;"
  if ($connectionTest -ne "1") { throw "Login PostgreSQL gagal atau server tidak mengembalikan respons yang diharapkan." }
  Write-Host "Koneksi superuser PostgreSQL berhasil." -ForegroundColor Green

  $roleExists = Invoke-PsqlScalar "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=$(SqlLiteral $appUser));"
  if ($roleExists -notin @("t", "true", "1")) {
    Invoke-PsqlCommand "CREATE ROLE $(SqlIdentifier $appUser) LOGIN PASSWORD $(SqlLiteral $appPassword);" "Gagal membuat role PostgreSQL."
    Write-Host "User PostgreSQL '$appUser' dibuat." -ForegroundColor Green
  } else {
    Invoke-PsqlCommand "ALTER ROLE $(SqlIdentifier $appUser) WITH LOGIN PASSWORD $(SqlLiteral $appPassword);" "Gagal memperbarui password role."
    Write-Host "User PostgreSQL '$appUser' sudah ada; password diselaraskan dengan .env." -ForegroundColor Green
  }

  $dbExists = Invoke-PsqlScalar "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname=$(SqlLiteral $dbName));"
  if ($dbExists -notin @("t", "true", "1")) {
    Invoke-PsqlCommand "CREATE DATABASE $(SqlIdentifier $dbName) OWNER $(SqlIdentifier $appUser);" "Gagal membuat database."
    Write-Host "Database PostgreSQL '$dbName' dibuat." -ForegroundColor Green
  } else {
    Invoke-PsqlCommand "ALTER DATABASE $(SqlIdentifier $dbName) OWNER TO $(SqlIdentifier $appUser);" "Gagal memperbarui pemilik database."
    Write-Host "Database PostgreSQL '$dbName' sudah tersedia." -ForegroundColor Green
  }

  Write-Host "Menguji koneksi menggunakan user aplikasi '$appUser'..." -ForegroundColor Cyan
  $env:PGPASSWORD = $appPassword
  $appTestOutput = @(& $psql -h $dbHost -p $dbPort -U $appUser -d $dbName -v ON_ERROR_STOP=1 -tAc "SELECT current_database();" 2>&1)
  if ($LASTEXITCODE -ne 0) {
    $message = ($appTestOutput | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    throw "Database dibuat, tetapi login user aplikasi gagal:`n$message"
  }

  Write-Host "Database siap. Jalankan: npm run db:init" -ForegroundColor Green
} finally {
  $env:PGPASSWORD = $oldPgPassword
  $plainAdminPassword = $null
}
