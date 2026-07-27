param(
    [string]$ManifestPath = "frontend/public/deployments/hyperevm-mainnet-999.json",
    [string]$ReleaseReportPath = "release/release-gate-last-run.json",
    [Parameter(Mandatory = $true)] [string]$PublicIndexerUrl,
    [Parameter(Mandatory = $true)] [string]$RpcUrl,
    [int]$MaxIndexerLagBlocks = 100,
    [switch]$ConfirmOnchainActivation,
    [switch]$ConfirmDrandHealthy,
    [switch]$ConfirmProjectXVerified,
    [switch]$ConfirmIndexerHealthy,
    [switch]$ConfirmMainnetE2E
)

$ErrorActionPreference = "Stop"
if (-not ($ConfirmOnchainActivation -and $ConfirmDrandHealthy -and $ConfirmProjectXVerified -and $ConfirmIndexerHealthy -and $ConfirmMainnetE2E)) {
    throw "All five independent confirmations are required before promoting the public manifest"
}
if ($PublicIndexerUrl -notmatch '^https://') { throw "PublicIndexerUrl must use HTTPS" }
if ($RpcUrl -notmatch '^https://') { throw "RpcUrl must use HTTPS" }
if ($MaxIndexerLagBlocks -lt 0) { throw "MaxIndexerLagBlocks cannot be negative" }

$projectRoot = Split-Path -Parent $PSScriptRoot
$resolved = Join-Path $projectRoot $ManifestPath
if (-not (Test-Path -LiteralPath $resolved)) { throw "Manifest not found: $resolved" }
$resolvedReport = Join-Path $projectRoot $ReleaseReportPath
if (-not (Test-Path -LiteralPath $resolvedReport)) { throw "Release report not found: $resolvedReport" }
$report = Get-Content -LiteralPath $resolvedReport -Raw | ConvertFrom-Json
if ($report.status -ne "passed" -or $report.chainTarget -ne 999) {
    throw "Release report must be a fully passed chain-999 gate"
}
if (-not $report.invocation.mainnetMode -or -not $report.selection.liveMainnetAttestationsExecuted) {
    throw "Release report does not prove live mainnet attestations"
}
if ($report.skippedSteps -ne 0 -or $report.broadcastRequested -or $report.broadcastPerformed) {
    throw "Release report contains skips or a broadcast attempt"
}
$requiredGateSteps = @(
    "Project X mainnet fork simulation",
    "Frontend Playwright E2E",
    "Indexer mainnet deterministic build",
    "Live 999 core attestation",
    "Live 999 drand BN254 attestation",
    "Live 999 Project X attestation",
    "Live 999 activation-readiness attestation"
)
foreach ($requiredStep in $requiredGateSteps) {
    $matches = @($report.steps | Where-Object { $_.name -eq $requiredStep -and $_.status -eq "passed" })
    if ($matches.Count -ne 1) { throw "Release report is missing passed step: $requiredStep" }
}
$manifest = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
if ($manifest.chainId -ne 999 -or $manifest.features.randomnessMode -ne "drand-bn254" -or $manifest.features.dexMode -ne "projectx") {
    throw "Manifest is not a HyperEVM mainnet drand-BN254/Project X deployment"
}
if (@($manifest.collections).Count -eq 0) { throw "Mainnet manifest has no reviewed collections" }
foreach ($collection in @($manifest.collections)) {
    if (-not $collection.deploymentBlock -or [long]$collection.deploymentBlock -le 0) {
        throw "Collection $($collection.address) is missing deploymentBlock"
    }
}

function Invoke-HwaRpc([string]$Method, [object[]]$Params) {
    $body = [ordered]@{ jsonrpc = "2.0"; id = 1; method = $Method; params = $Params } | ConvertTo-Json -Depth 12 -Compress
    $response = Invoke-RestMethod -Uri $RpcUrl -Method Post -ContentType "application/json" -Body $body -TimeoutSec 30
    if ($response.error) { throw "RPC $Method failed: $($response.error.message)" }
    return $response.result
}

$chainHex = Invoke-HwaRpc "eth_chainId" @()
if ([Convert]::ToInt64(([string]$chainHex).Substring(2), 16) -ne 999) { throw "Live RPC is not HyperEVM mainnet chain 999" }
$headHex = Invoke-HwaRpc "eth_blockNumber" @()
$chainHead = [Convert]::ToInt64(([string]$headHex).Substring(2), 16)
foreach ($property in $manifest.contracts.PSObject.Properties) {
    $code = Invoke-HwaRpc "eth_getCode" @([string]$property.Value, "latest")
    if (-not $code -or $code -eq "0x") { throw "No live bytecode for contracts.$($property.Name) at $($property.Value)" }
}

$indexerBody = @{ query = "{ _meta { block { number } hasIndexingErrors } }" } | ConvertTo-Json -Compress
$indexerResponse = Invoke-RestMethod -Uri $PublicIndexerUrl -Method Post -ContentType "application/json" -Body $indexerBody -TimeoutSec 30
if ($indexerResponse.errors -or -not $indexerResponse.data._meta.block.number) {
    throw "Indexer health query failed"
}
if ($indexerResponse.data._meta.hasIndexingErrors) { throw "Indexer reports indexing errors" }
$indexedBlock = [long]$indexerResponse.data._meta.block.number
$indexerLag = $chainHead - $indexedBlock
if ($indexerLag -lt 0) { $indexerLag = 0 }
if ($indexerLag -gt $MaxIndexerLagBlocks) {
    throw "Indexer is $indexerLag blocks behind chain head; maximum allowed is $MaxIndexerLagBlocks"
}

$manifest.features.writesEnabled = $true
$manifest.features.acquisitionsEnabled = $true
$manifest | Add-Member -NotePropertyName indexer -NotePropertyValue ([ordered]@{
    url = $PublicIndexerUrl
    confirmedAtUtc = [DateTime]::UtcNow.ToString("o")
    indexedBlock = $indexedBlock
    chainHeadAtConfirmation = $chainHead
    lagBlocks = $indexerLag
    releaseReportGeneratedAtUtc = $report.generatedAtUtc
}) -Force

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($resolved, ($manifest | ConvertTo-Json -Depth 10), $utf8NoBom)
Write-Host "Promoted mainnet manifest after all release attestations: $resolved"
Write-Host "Set NEXT_PUBLIC_INDEXER_URL to $PublicIndexerUrl in the production frontend environment."
