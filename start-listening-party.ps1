$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Starting API web server on port 8000..."
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location -Path '$root'; python server.py"
)

Write-Host "Starting controller..."
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location -Path '$root'; python controller.py"
)

Write-Host "Both terminals launched."
