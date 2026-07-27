param(
    [Parameter(Mandatory = $true)] [string]$Fwa,
    [Parameter(Mandatory = $true)] [string]$Whitelist,
    [Parameter(Mandatory = $true)] [string]$VrfService,
    [Parameter(Mandatory = $true)] [string]$RandomnessCoordinator,
    [Parameter(Mandatory = $true)] [string]$RandomnessRegistry,
    [Parameter(Mandatory = $true)] [string]$Splitter,
    [Parameter(Mandatory = $true)] [string]$Rewards,
    [Parameter(Mandatory = $true)] [string]$Token,
    [Parameter(Mandatory = $true)] [string]$ProjectXAdapter,
    [Parameter(Mandatory = $true)] [string]$ProjectXPool,
    [Parameter(Mandatory = $true)] [string]$ProjectXLiquidityLocker,
    [Parameter(Mandatory = $true)] [string]$SnapshotNft,
    [Parameter(Mandatory = $true)] [long]$SnapshotDeploymentBlock,
    [Parameter(Mandatory = $true)] [int]$SnapshotMaxTokenId,
    [Parameter(Mandatory = $true)] [long]$DeployedAtBlock,
    [Parameter(Mandatory = $true)] [string]$CollectionsJson,
    [string]$ProjectXTradeUrl = "",
    [string]$OutputPath = "frontend/public/deployments/hyperevm-mainnet-999.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$zero = "0x0000000000000000000000000000000000000000"
$addressPattern = '^0x[0-9a-fA-F]{40}$'
$values = @($Fwa, $Whitelist, $VrfService, $RandomnessCoordinator, $RandomnessRegistry, $Splitter, $Rewards, $Token, $ProjectXAdapter, $ProjectXPool, $ProjectXLiquidityLocker, $SnapshotNft)
foreach ($value in $values) {
    if ($value -notmatch $addressPattern -or $value -eq $zero) {
        throw "Invalid or zero deployment address: $value"
    }
}
if ($DeployedAtBlock -le 0) { throw "DeployedAtBlock must be positive" }
if ($SnapshotDeploymentBlock -le 0) { throw "SnapshotDeploymentBlock must be positive" }
if ($SnapshotMaxTokenId -le 0 -or $SnapshotMaxTokenId -gt 10000) { throw "SnapshotMaxTokenId must be between 1 and 10000" }
if ($ProjectXTradeUrl -and $ProjectXTradeUrl -notmatch '^https://') { throw "ProjectXTradeUrl must use HTTPS" }

try {
    $parsedCollections = $CollectionsJson | ConvertFrom-Json
    $collections = @($parsedCollections)
} catch {
    throw "CollectionsJson must be a JSON array: $($_.Exception.Message)"
}
if ($collections.Count -eq 0) { throw "At least one reviewed mainnet collection is required" }
foreach ($collection in $collections) {
    if ($collection.address -notmatch $addressPattern -or $collection.address -eq $zero) {
        throw "Invalid collection address: $($collection.address)"
    }
    if ([string]::IsNullOrWhiteSpace($collection.name)) { throw "Every collection needs a display name" }
    if (-not $collection.deploymentBlock -or [long]$collection.deploymentBlock -le 0) {
        throw "Collection $($collection.address) needs a positive deploymentBlock for complete ownership indexing"
    }
    $collection | Add-Member -NotePropertyName testnetFixture -NotePropertyValue $false -Force
}
$snapshotEntry = @($collections | Where-Object { $_.address -ieq $SnapshotNft })
if ($snapshotEntry.Count -eq 0) {
    $collections += [pscustomobject][ordered]@{
        address = $SnapshotNft
        name = "HWA Genesis Snapshot"
        symbol = "HWA-GEN"
        deploymentBlock = $SnapshotDeploymentBlock
        maxTokenId = $SnapshotMaxTokenId
        testnetFixture = $false
        snapshotCollection = $true
    }
} else {
    if ([long]$snapshotEntry[0].deploymentBlock -ne $SnapshotDeploymentBlock) {
        throw "Snapshot collection deploymentBlock does not match SnapshotDeploymentBlock"
    }
    $snapshotEntry[0] | Add-Member -NotePropertyName maxTokenId -NotePropertyValue $SnapshotMaxTokenId -Force
    $snapshotEntry[0] | Add-Member -NotePropertyName snapshotCollection -NotePropertyValue $true -Force
}

$manifest = [ordered]@{
    schemaVersion = 1
    chainId = 999
    deployedAtBlock = $DeployedAtBlock
    contracts = [ordered]@{
        fwa = $Fwa
        whitelist = $Whitelist
        vrfService = $VrfService
        randomnessCoordinator = $RandomnessCoordinator
        randomnessRegistry = $RandomnessRegistry
        splitter = $Splitter
        rewards = $Rewards
        token = $Token
        projectXAdapter = $ProjectXAdapter
        projectXPool = $ProjectXPool
        projectXLiquidityLocker = $ProjectXLiquidityLocker
        snapshotNft = $SnapshotNft
    }
    features = [ordered]@{
        writesEnabled = $false
        acquisitionsEnabled = $false
        randomnessMode = "drand-bn254"
        dexMode = "projectx"
    }
    collections = $collections
}
if ($ProjectXTradeUrl) {
    $manifest["links"] = [ordered]@{ projectXTradeUrl = $ProjectXTradeUrl }
}

$resolvedOutput = Join-Path $projectRoot $OutputPath
$outputParent = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Force -Path $outputParent | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($resolvedOutput, ($manifest | ConvertTo-Json -Depth 8), $utf8NoBom)
Write-Host "Wrote fail-closed mainnet manifest to $resolvedOutput"
Write-Host "Writes and acquisitions remain false until post-deployment attestations pass."
