param(
  [switch]$RefreshServerDiscogs
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$serverArgs = @()
if ($RefreshServerDiscogs) {
  $serverArgs += "--refresh-discogs"
}
$serverArgsText = $serverArgs -join " "

Write-Host "Starting API web server on port 8000..."
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location -Path '$root'; python server.py $serverArgsText"
)

Write-Host "Server terminal launched."
