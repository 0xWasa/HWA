[CmdletBinding()]
param(
    [string]$Provider = $env:HYPEREVM_LOG_RPC_PROVIDER,
    [string]$RpcUrl = $env:HYPEREVM_LOG_RPC_UPSTREAM_URL,
    [string]$ApiKey = $env:HYPEREVM_LOG_RPC_API_KEY,
    [string]$ApiKeyHeader = $(if ($env:HYPEREVM_LOG_RPC_API_KEY_HEADER) { $env:HYPEREVM_LOG_RPC_API_KEY_HEADER } else { "x-api-key" }),
    [int]$MaxBlockRange = $(if ($env:HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE) { [int]$env:HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE } else { 2500 }),
    [long]$ArchiveDepthBlocks = 1000000,
    [string]$ActiveContract = "0x5555555555555555555555555555555555555555",
    [int]$HistoricalEventScanBlocks = 5000,
    [string]$OutputPath = "release/log-rpc-probe-999.json"
)

$ErrorActionPreference = "Stop"
$expectedChainId = 999
$emptyProbeAddress = "0x000000000000000000000000000000000000dEaD"
$transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

if (-not $Provider) { throw "Provider is required (HYPEREVM_LOG_RPC_PROVIDER)." }
if (-not $RpcUrl) { throw "RPC URL is required (HYPEREVM_LOG_RPC_UPSTREAM_URL)." }
if ($MaxBlockRange -lt 1000) { throw "MaxBlockRange must be at least 1000." }
if ($ArchiveDepthBlocks -lt $MaxBlockRange) { throw "ArchiveDepthBlocks must be at least MaxBlockRange." }
if ($ActiveContract -notmatch '^0x[0-9a-fA-F]{40}$') { throw "ActiveContract must be an EVM address." }
if ($ApiKeyHeader -notmatch '^[a-zA-Z0-9-]{1,64}$') { throw "Invalid API-key header name." }

$uri = [Uri]$RpcUrl
if ($uri.Scheme -ne "https" -or $uri.UserInfo) { throw "RPC URL must be credential-free HTTPS." }
$headers = @{ Accept = "application/json" }
if ($ApiKey) { $headers[$ApiKeyHeader] = $ApiKey }
$latencies = [System.Collections.Generic.List[double]]::new()
$nextId = 0

function Invoke-LogRpc([string]$Method, [object[]]$Params) {
    $script:nextId += 1
    $payload = @{ jsonrpc = "2.0"; id = $script:nextId; method = $Method; params = $Params } | ConvertTo-Json -Depth 12 -Compress
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $response = Invoke-RestMethod -Method Post -Uri $script:RpcUrl -Headers $script:headers -ContentType "application/json" -Body $payload -TimeoutSec 20
    }
    finally {
        $watch.Stop()
        $script:latencies.Add($watch.Elapsed.TotalMilliseconds)
    }
    if ($null -ne $response.error) {
        throw "JSON-RPC $Method failed: code=$($response.error.code) message=$($response.error.message)"
    }
    return $response.result
}

function To-Hex([long]$Value) { return ("0x{0:x}" -f $Value) }

$chainHex = Invoke-LogRpc "eth_chainId" @()
$chainId = [Convert]::ToInt64(($chainHex -replace '^0x', ''), 16)
if ($chainId -ne $expectedChainId) { throw "Provider returned chain $chainId, expected $expectedChainId." }

$headHex = Invoke-LogRpc "eth_blockNumber" @()
$head = [Convert]::ToInt64(($headHex -replace '^0x', ''), 16)
if ($head -le $ArchiveDepthBlocks) { throw "Chain head $head is shallower than requested archive depth." }
$historicalBlock = $head - $ArchiveDepthBlocks

$block = Invoke-LogRpc "eth_getBlockByNumber" @((To-Hex $historicalBlock), $false)
if ($null -eq $block -or [Convert]::ToInt64(($block.number -replace '^0x', ''), 16) -ne $historicalBlock) {
    throw "Historical block lookup failed at $historicalBlock."
}

# Historical state is the differentiator between a full archive endpoint and a block-history-only node.
$null = Invoke-LogRpc "eth_getBalance" @($ActiveContract, (To-Hex $historicalBlock))

# Prove the advertised getLogs range without depending on event density.
$rangeEnd = $historicalBlock + $MaxBlockRange - 1
$emptyLogs = @(Invoke-LogRpc "eth_getLogs" @(@{
    address = $emptyProbeAddress
    fromBlock = To-Hex $historicalBlock
    toBlock = To-Hex $rangeEnd
}))

# Independently prove that historical event data is returned, using old wHYPE Transfer logs.
$historicalLogCount = 0
$scanCursor = $historicalBlock
$scanEnd = [Math]::Min($head, $historicalBlock + $HistoricalEventScanBlocks - 1)
while ($scanCursor -le $scanEnd -and $historicalLogCount -eq 0) {
    $windowEnd = [Math]::Min($scanEnd, $scanCursor + 99)
    $logs = @(Invoke-LogRpc "eth_getLogs" @(@{
        address = $ActiveContract
        topics = @($transferTopic)
        fromBlock = To-Hex $scanCursor
        toBlock = To-Hex $windowEnd
    }))
    $historicalLogCount += $logs.Count
    $scanCursor = $windowEnd + 1
}
if ($historicalLogCount -eq 0) {
    throw "No historical Transfer log found for $ActiveContract in the $HistoricalEventScanBlocks-block probe window. Choose another active contract or a known historical window."
}

# Small sequential burst catches low hidden request ceilings without becoming a load test.
for ($i = 0; $i -lt 10; $i++) { $null = Invoke-LogRpc "eth_chainId" @() }

$ordered = $latencies | Sort-Object
$p95Index = [Math]::Min($ordered.Count - 1, [Math]::Ceiling($ordered.Count * 0.95) - 1)
$urlFingerprintBytes = [Text.Encoding]::UTF8.GetBytes($RpcUrl)
$sha = [Security.Cryptography.SHA256]::Create()
try { $urlFingerprint = ([BitConverter]::ToString($sha.ComputeHash($urlFingerprintBytes))).Replace("-", "").ToLowerInvariant() }
finally { $sha.Dispose() }

$report = [ordered]@{
    schemaVersion = 1
    testedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    provider = $Provider
    endpointHost = $uri.Host
    endpointFingerprintSha256 = $urlFingerprint
    chainId = $chainId
    headBlock = $head
    archiveDepthBlocks = $ArchiveDepthBlocks
    historicalBlock = $historicalBlock
    historicalBlockReadable = $true
    historicalStateReadable = $true
    getLogsRangeBlocks = $MaxBlockRange
    emptyRangeProbeResultCount = $emptyLogs.Count
    historicalEventProbeAddress = $ActiveContract
    historicalEventProbeCount = $historicalLogCount
    requestCount = $latencies.Count
    latencyMs = [ordered]@{
        average = [Math]::Round((($latencies | Measure-Object -Average).Average), 2)
        p95 = [Math]::Round($ordered[$p95Index], 2)
        max = [Math]::Round($ordered[-1], 2)
    }
    result = "passed"
}

$resolvedOutput = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path (Split-Path $PSScriptRoot -Parent) $OutputPath }
$directory = Split-Path $resolvedOutput -Parent
if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
Write-Host "PASS: $Provider chain=$chainId archiveDepth=$ArchiveDepthBlocks getLogsRange=$MaxBlockRange p95=$($report.latencyMs.p95)ms"
Write-Host "Attestation: $resolvedOutput"
