<#
.SYNOPSIS
  Hermes Home readiness ladder (spec §41). Works on PowerShell 5.1 and 7+.

.DESCRIPTION
  Colored, line-by-line proof the stack is ready to connect to Alexa+.
  Answers the single question: "can I onboard now?"
#>
param(
  [string]$McpUrl = '',
  [string]$HermesUrl = ''
)
if (-not $McpUrl)    { $McpUrl    = $env:HERMES_HOME_MCP_URL; if (-not $McpUrl)    { $McpUrl    = 'http://127.0.0.1:3000' } }
if (-not $HermesUrl) { $HermesUrl = $env:HERMES_API_URL;      if (-not $HermesUrl) { $HermesUrl = 'http://127.0.0.1:8642' } }

$ErrorActionPreference = 'Continue'
$report = [ordered]@{}
$script:sessionId = $null

function Check {
  param([string]$Name, [scriptblock]$Block, [string]$Fix)
  try {
    $detail = & $Block
    if ($null -eq $detail) { $detail = '' }
    $report[$Name] = @{ ok = $true; detail = $detail }
    Write-Host ("  [OK]   {0}  {1}" -f $Name, $detail) -ForegroundColor Green
  } catch {
    $report[$Name] = @{ ok = $false; detail = $_.Exception.Message; fix = $Fix }
    Write-Host ("  [FAIL] {0}  {1}" -f $Name, $_.Exception.Message) -ForegroundColor Red
    Write-Host ("         fix: {0}" -f $Fix) -ForegroundColor DarkYellow
  }
}

Write-Host "== 1. Process and config ==" -ForegroundColor Cyan

Check -Name 'MCP /health' -Fix 'npm run dev:mcp from the repo root' -Block {
  $r = Invoke-RestMethod -Uri "$McpUrl/health" -TimeoutSec 5
  if (-not $r.ok) { throw 'not ok' }
  "$($r.service)"
}

Check -Name 'MCP /ready (Hermes reachable)' -Fix 'Start Hermes: API_SERVER_ENABLED=true hermes gateway. docs/hermes.md' -Block {
  $r = Invoke-RestMethod -Uri "$McpUrl/ready" -TimeoutSec 5
  if (-not $r.ready) {
    $why = $r.hermes.error; if (-not $why) { $why = 'unknown' }
    throw "hermes: $why"
  }
  "hermes ok"
}

Write-Host ''
Write-Host "== 2. MCP protocol ==" -ForegroundColor Cyan

$acceptHdr = 'application/json, text/event-stream'

# PowerShell mangles embedded quotes when passing to curl.exe directly,
# so each request body goes on disk once and is handed to curl with --data-binary @file.
$script:tmpInit = Join-Path $env:TEMP 'hermes-init.json'
$script:tmpList = Join-Path $env:TEMP 'hermes-list.json'
[IO.File]::WriteAllText($script:tmpInit, '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"onboard","version":"0.1"}}}')
[IO.File]::WriteAllText($script:tmpList, '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')

Check -Name 'MCP initialize (session id)' -Fix 'POST /mcp must accept initialize and return mcp-session-id' -Block {
  $out = & curl.exe -s -i -X POST "$McpUrl/mcp" `
    -H 'content-type: application/json' `
    -H 'accept: application/json, text/event-stream' `
    --data-binary "@$script:tmpInit" 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "curl failed: $out" }
  $m = [regex]::Match($out, 'mcp-session-id:\s*([0-9a-fA-F-]+)')
  if (-not $m.Success) { throw "no mcp-session-id header in: " + ($out -replace "`r?`n", ' | ') }
  $script:sessionId = $m.Groups[1].Value
  "session $($script:sessionId.Substring(0,8))..."
}

Check -Name 'tools/list (14 tools)' -Fix 'registry must expose all tools — apps/mcp-server/src/tools/registry.ts' -Block {
  if (-not $script:sessionId) { throw 'no session from initialize' }
  $raw = & curl.exe -s -X POST "$McpUrl/mcp" `
    -H 'content-type: application/json' `
    -H "accept: application/json, text/event-stream" `
    -H "mcp-session-id: $script:sessionId" `
    --data-binary "@$script:tmpList" 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "curl failed" }
  $names = [regex]::Matches($raw, '"name":"([a-z][a-z_]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  $expected = @('hermes_ask','hermes_start_task','hermes_task_status','hermes_task_result',
                'hermes_memory_search','hermes_remember','home_get_state','home_control',
                'calendar_today','calendar_tomorrow','calendar_events',
                'github_my_issues','github_repo_issues','send_message')
  $missing = $expected | Where-Object { $names -notcontains $_ }
  if ($missing) { throw "missing: $($missing -join ', ')" }
  "$($names.Count) tools"
}

Write-Host ''
Write-Host "== 3. Security guardrails (must hold before going public) ==" -ForegroundColor Cyan

Check -Name 'DNS-rebind: foreign Origin rejected' -Fix 'transport.ts refuses non-local origins in local mode' -Block {
  $out = & curl.exe -s -o NUL -w '%{http_code}' -X POST "$McpUrl/mcp" `
    -H 'content-type: application/json' -H 'origin: https://evil.example.com' `
    --data-binary "@$script:tmpInit"
  if ($out -ne '403') { throw "expected 403, got $out" }
  '403'
}

Check -Name 'OAuth discovery documents' -Fix 'Serve both well-known docs. See docs/oauth-reference/README.md' -Block {
  $a = Invoke-RestMethod -Uri "$McpUrl/.well-known/oauth-protected-resource" -TimeoutSec 5
  $b = Invoke-RestMethod -Uri "$McpUrl/.well-known/oauth-authorization-server" -TimeoutSec 5
  if (-not $a.authorization_servers) { throw 'protected-resource doc malformed' }
  if ($b.code_challenge_methods_supported -notcontains 'S256') { throw 'S256 not advertised' }
  "issuer=$($b.issuer)"
}

Write-Host ''
Write-Host "== 4. Integrations (what this bridge can do today) ==" -ForegroundColor Cyan

$ready = Invoke-RestMethod -Uri "$McpUrl/ready" -TimeoutSec 5
$ints = $ready.integrations

Check -Name 'Home Assistant' -Fix 'Set HASS_URL + HASS_TOKEN in .env (long-lived access token). docs/alexa.md' -Block {
  if (-not $ints.homeAssistant.ok) {
    $why = $ints.homeAssistant.error; if (-not $why) { $why = 'not configured' }
    throw $why
  }
  "$($ints.homeAssistant.detail)"
}

Check -Name 'Calendar' -Fix 'Set CALENDAR_ICS_URL (or CALDAV_*) in .env — docs/integrations.md' -Block {
  if (-not $ints.calendar.ok) { throw 'not configured' }
  'configured'
}

Check -Name 'GitHub' -Fix 'Set GITHUB_TOKEN + GITHUB_USER in .env — docs/integrations.md' -Block {
  if (-not $ints.github.ok) { throw 'not configured' }
  'configured'
}

Check -Name 'Messaging' -Fix 'Set TELEGRAM_BOT_TOKEN/CHAT_ID, DISCORD_WEBHOOK_URL or SLACK_WEBHOOK_URL' -Block {
  if (-not $ints.messaging.ok) { throw 'no channels configured' }
  "channels: " + ($ints.messaging.channels -join ',')
}

Write-Host ''
Write-Host "=============== READINESS SUMMARY ===============" -ForegroundColor Cyan
$pass = 0; $fail = 0
foreach ($k in $report.Keys) { if ($report[$k].ok) { $pass++ } else { $fail++ } }
Write-Host "$pass ready, $fail not ready"
if ($fail -gt 0) {
  Write-Host ''
  Write-Host "Not yet ready:" -ForegroundColor Yellow
  foreach ($k in $report.Keys) {
    if (-not $report[$k].ok) { Write-Host ("  - {0} - {1}" -f $k, $report[$k].fix) }
  }
}
Write-Host ''
Write-Host "Next steps once top sections are green:" -ForegroundColor Cyan
Write-Host '  cloudflared tunnel --url http://localhost:3000'
Write-Host '  Then: docs/alexa.md onboarding checklist (simulator first, physical device last)'
exit ([int]($fail -gt 0))
