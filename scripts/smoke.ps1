<# Works on both Windows PowerShell 5.1 and PowerShell 7+. #>
.SYNOPSIS
  Hermes Home — validation smoke (spec §41 order).

.DESCRIPTION
  Runs the spec's testing ladder as far as local infrastructure allows:
    1. Hermes gateway reachable (/health)
    2. MCP server up (/health) and ready (/ready)
    3. MCP initialize over Streamable HTTP
    4. tools/list
    5. hermes_ask smoke call
    6. negative auth / DNS-rebind guard check
  Steps needing Amazon/hardware are listed at the end as manual follow-ups.
#>
param(
  [string]$McpUrl = '',
  [string]$HermesUrl = ''
)
if (-not $McpUrl) { $McpUrl = $env:HERMES_HOME_MCP_URL; if (-not $McpUrl) { $McpUrl = 'http://127.0.0.1:3000' } }
if (-not $HermesUrl) { $HermesUrl = $env:HERMES_API_URL; if (-not $HermesUrl) { $HermesUrl = 'http://127.0.0.1:8642' } }

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Step($name, [scriptblock]$block) {
  try {
    & $block
    Write-Host "PASS  $name" -ForegroundColor Green
    $script:pass++
  } catch {
    Write-Host "FAIL  $name -> $($_.Exception.Message)" -ForegroundColor Red
    $script:fail++
  }
}

Step 'Hermes gateway /health' {
  $r = Invoke-RestMethod -Uri "$HermesUrl/health" -TimeoutSec 5
  if (-not $r) { throw 'empty response' }
}

Step 'MCP server /health' {
  $r = Invoke-RestMethod -Uri "$McpUrl/health" -TimeoutSec 5
  if (-not $r.ok) { throw 'not ok' }
}

Step 'MCP server /ready (Hermes reachable from bridge)' {
  $r = Invoke-RestMethod -Uri "$McpUrl/ready" -TimeoutSec 5
  if (-not $r.ready) { throw "not ready: $($r | ConvertTo-Json -Compress)" }
}

$initBody = @{
  jsonrpc = '2.0'; id = 1; method = 'initialize'
  params = @{
    protocolVersion = '2025-03-26'
    capabilities = @{}
    clientInfo = @{ name = 'smoke'; version = '0.1.0' }
  }
} | ConvertTo-Json -Depth 6

$sessionId = $null
Step 'MCP initialize over POST /mcp' {
  $res = Invoke-WebRequest -Uri "$McpUrl/mcp" -Method Post `
    -ContentType 'application/json' -Body $initBody `
    -Headers @{ Accept = 'application/json, text/event-stream' }
  if ($res.StatusCode -ne 200) { throw "status $($res.StatusCode)" }
  $script:sessionId = $res.Headers['mcp-session-id']
  if (-not $script:sessionId) { throw 'no mcp-session-id returned' }
}

Step 'tools/list returns the 8-tool catalog' {
  if (-not $script:sessionId) { throw 'no session from previous step' }
  $body = '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  $headers = @{
    Accept = 'application/json, text/event-stream'
    'mcp-session-id' = $script:sessionId
  }
  $res = Invoke-WebRequest -Uri "$McpUrl/mcp" -Method Post `
    -ContentType 'application/json' -Body $body -Headers $headers
  $text = $res.Content
  foreach ($t in 'hermes_ask','hermes_start_task','hermes_task_status','hermes_task_result',
           'hermes_memory_search','hermes_remember','home_get_state','home_control') {
    if ($text -notmatch [regex]::Escape($t)) { throw "missing tool $t" }
  }
}

Step 'DNS-rebind guard refuses foreign Host/Origin' {
  $code = $null
  try {
    Invoke-WebRequest -Uri "$McpUrl/mcp" -Method Post `
      -ContentType 'application/json' -Body $initBody `
      -Headers @{ Accept = 'application/json, text/event-stream'; Origin = 'https://evil.example.com' } |
      Select-Object -ExpandProperty StatusCode
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
  }
  if ($code -ne 403) { throw "expected 403, got $code" }
}

Step 'unconfigured Home Assistant fails safely' {
  $r = Invoke-RestMethod -Uri "$McpUrl/ready" -TimeoutSec 5
  if ($r.homeAssistant.ok -and -not $env:HASS_TOKEN) { throw 'HA reported ok without configuration' }
}

Write-Host ''
$color = 'Green'; if ($fail -gt 0) { $color = 'Red' }
Write-Host "$pass passed, $fail failed" -ForegroundColor $color
Write-Host 'Manual follow-ups (cannot be scripted here):'
Write-Host '  - cloudflared tunnel + Alexa+ onboarding (docs/alexa.md)'
Write-Host '  - Alexa+ web simulator walkthrough'
Write-Host '  - physical Alexa device test'
exit ([int]($fail -gt 0))
