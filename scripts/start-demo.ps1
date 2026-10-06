# One command to bring the whole demo stack up (safe to re-run).
#   npm run demo
# Starts: SSH tunnel to the Hermes VM -> MCP bridge -> Alexa+ simulator, then
# verifies each hop and prints the URL to open. PowerShell 5.1 compatible.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Read-EnvValue($name, $default) {
    if (Test-Path .env) {
        $line = Get-Content .env | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
        if ($line) { return ($line -split '=', 2)[1].Trim() }
    }
    return $default
}
function Stop-Port($port) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
function Test-Port($port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

$mcpPort = [int](Read-EnvValue 'PORT' '3000')
$simPort = [int](Read-EnvValue 'DASHBOARD_PORT' '3100')
$vmHost  = Read-EnvValue 'HERMES_VM' ''      # e.g. user@1.2.3.4 (SSH host of the Hermes VM)
$sshKey  = Read-EnvValue 'HERMES_SSH_KEY' "$env:USERPROFILE\.ssh\id_ed25519"
if (-not $vmHost) { Write-Host 'Set HERMES_VM=user@host (and HERMES_SSH_KEY) in .env' -ForegroundColor Red; exit 1 }

Write-Host '== Hermes Home demo stack ==' -ForegroundColor Cyan

# 0. a foreign process on our port? refuse rather than kill someone else's app
if ((Test-Port $mcpPort)) {
    $owner = (Get-CimInstance Win32_Process -Filter "ProcessId=$((Get-NetTCPConnection -LocalPort $mcpPort -State Listen | Select-Object -First 1).OwningProcess)").CommandLine
    if ($owner -notmatch 'mcp-server') {
        Write-Host "Port $mcpPort is used by another app:`n  $owner`nChange PORT in .env (e.g. 3010) and re-run." -ForegroundColor Red
        exit 1
    }
}

# 1. build
Write-Host '[1/4] build'; npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'build failed - run npm run build' -ForegroundColor Red; exit 1 }

# 2. tunnel to Hermes
Write-Host '[2/4] ssh tunnel -> Hermes VM (:8642)'
if (-not (Test-Port 8642)) {
    Start-Process ssh -WindowStyle Hidden -ArgumentList '-N', '-L', '8642:127.0.0.1:8642', '-i', $sshKey,
        '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes', $vmHost
    Start-Sleep 4
}
if (-not (Test-Port 8642)) { Write-Host 'tunnel failed - is the VM up and the key correct?' -ForegroundColor Red; exit 1 }

# 3. MCP bridge (restart so it always has the latest .env)
Write-Host "[3/4] MCP bridge (:$mcpPort)"
Stop-Port $mcpPort
Start-Process node -WindowStyle Hidden -ArgumentList 'apps/mcp-server/dist/server.js'

# 4. simulator
Write-Host "[4/4] Alexa+ simulator (:$simPort)"
Stop-Port $simPort
$env:MCP_URL = "http://127.0.0.1:$mcpPort"
if (Test-Path .env) {
    Get-Content .env | Where-Object { $_ -match '^(SIM_[A-Z_]+|GOOGLE_API_KEY)=' } | ForEach-Object {
        $kv = $_ -split '=', 2; Set-Item -Path ("env:" + $kv[0]) -Value $kv[1].Trim()
    }
}
Start-Process node -WindowStyle Hidden -ArgumentList 'apps/dashboard/src/server.js'

# verify
$ok = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep 1
    try { $h = Invoke-RestMethod "http://127.0.0.1:$mcpPort/health" -TimeoutSec 2; if ($h.ok -and (Test-Port $simPort)) { $ok = $true; break } } catch {}
}
if (-not $ok) { Write-Host 'stack did not come up - check the ports above' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host "READY  ->  http://127.0.0.1:$simPort/sim" -ForegroundColor Green
Write-Host '(Hermes replies take ~20 s; the page speaks an acknowledgement while it works.)'
