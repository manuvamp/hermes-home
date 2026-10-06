<#
.SYNOPSIS
  Hermes Home — one-command local developer environment.

.DESCRIPTION
  Starts, in separate windows:
    1. the MCP server (tsx watch)
    2. the developer dashboard
  Optionally also launches a Cloudflare quick tunnel if cloudflared is installed.

.PARAMETER Tunnel
  Also start `cloudflared tunnel --url http://localhost:3000` (quick tunnel)
  and print the public URL Alexa+ onboarding will use.
#>
param(
  [switch]$Tunnel,
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot\.."
Set-Location $root

Write-Host 'Installing dependencies (if needed)…' -ForegroundColor Cyan
if (-not (Test-Path 'node_modules')) { npm install }

Write-Host 'Building shared package…' -ForegroundColor Cyan
npm run build --workspace @hermes-home/shared | Out-Null

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host ".env created from template — edit it to point at real credentials." -ForegroundColor Yellow
}

$psExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $psExe) { $psExe = 'powershell' }

Write-Host "Starting MCP server on :$Port and dashboard on :3100 in new windows..." -ForegroundColor Green
Start-Process $psExe -ArgumentList '-NoLogo','-NoExit','-Command', "cd '$root'; npm run dev:mcp"
Start-Process $psExe -ArgumentList '-NoLogo','-NoExit','-Command', "cd '$root'; npm run dev --workspace @hermes-home/dashboard"

if ($Tunnel) {
  $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cloudflared) {
    Write-Host 'Starting Cloudflare quick tunnel... (public URL appears in its output)' -ForegroundColor Green
    Start-Process $psExe -ArgumentList '-NoLogo','-NoExit','-Command', "cloudflared tunnel --url http://localhost:$Port"
  } else {
    Write-Warning 'cloudflared not on PATH - install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ to expose the server publicly.'
  }
}

Write-Host ''
Write-Host 'Ready to connect:' -ForegroundColor Cyan
Write-Host "  MCP endpoint  — http://127.0.0.1:$Port/mcp"
Write-Host '  Dashboard     — http://127.0.0.1:3100'
Write-Host '  Health / ready — /health · /ready'
Write-Host '  Next step     — validate end-to-end:  pwsh scripts/onboard.ps1'
