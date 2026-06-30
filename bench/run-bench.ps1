# Benchmark rload (Rust) vs node-load.js (Node) against the local test server.
# Usage: pwsh bench/run-bench.ps1 [-Concurrency 100] [-Requests 50000]
param(
  [int]$Concurrency = 100,
  [int]$Requests = 50000,
  [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$url = "http://127.0.0.1:$Port/"

Write-Host "Starting test server on port $Port..." -ForegroundColor Cyan
$server = Start-Process -FilePath "node" -ArgumentList "`"$root\bench\server.js`"", "$Port" -PassThru -NoNewWindow
Start-Sleep -Seconds 1

try {
  Write-Host "`n=== Rust (rload) ===" -ForegroundColor Green
  & "$root\target\release\rload.exe" $url -c $Concurrency -n $Requests

  Write-Host "`n=== Node (node-load.js) ===" -ForegroundColor Yellow
  node "$root\bench\node-load.js" $url -c $Concurrency -n $Requests
}
finally {
  Write-Host "`nStopping test server..." -ForegroundColor Cyan
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}
