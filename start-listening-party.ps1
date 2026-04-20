param(
  [switch]$RefreshServerDiscogs,
  [switch]$RefreshControllerDiscogs,
  [switch]$AllowControllerOnlineFetch,
  [switch]$BackfillControllerTracks
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$serverArgs = @()
if ($RefreshServerDiscogs) {
  $serverArgs += "--refresh-discogs"
}
$serverArgsText = $serverArgs -join " "

$controllerArgs = @()
if ($RefreshControllerDiscogs) {
  $controllerArgs += "--refresh-discogs"
}
if ($AllowControllerOnlineFetch) {
  $controllerArgs += "--allow-online-fetch"
}
if ($BackfillControllerTracks) {
  $controllerArgs += "--backfill-all-tracks"
}
$controllerArgsText = $controllerArgs -join " "

Write-Host "Starting API web server on port 8000..."
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location -Path '$root'; python server.py $serverArgsText"
)

Write-Host "Starting controller..."
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location -Path '$root'; python controller.py $controllerArgsText"
)

Write-Host "Both terminals launched."
