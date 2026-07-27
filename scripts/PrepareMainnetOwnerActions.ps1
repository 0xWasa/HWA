param(
    [Parameter(Mandatory = $true)] [string]$Fwa,
    [Parameter(Mandatory = $true)] [string]$Whitelist,
    [Parameter(Mandatory = $true)] [string]$Rewards,
    [Parameter(Mandatory = $true)] [string]$Token,
    [Parameter(Mandatory = $true)] [string]$Splitter,
    [Parameter(Mandatory = $true)] [string[]]$Collections,
    [Parameter(Mandatory = $true)] [string]$CanaryCollection,
    [string]$Coordinator,
    [string]$RpcUrl,
    [switch]$OfflineTemplate,
    [string]$OutputPath = "release/mainnet-owner-actions.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$cast = Join-Path $projectRoot ".tools\foundry\cast.exe"
if (-not (Test-Path -LiteralPath $cast)) { throw "Foundry cast not found at $cast" }
$addressPattern = '^0x[0-9a-fA-F]{40}$'
$zero = "0x0000000000000000000000000000000000000000"
foreach ($address in @($Fwa, $Whitelist, $Rewards, $Token, $Splitter) + $Collections) {
    if ($address -notmatch $addressPattern -or $address -eq $zero) { throw "Invalid or zero address: $address" }
}
if ($Collections.Count -eq 0) { throw "At least one collection is required" }
if ($CanaryCollection -notmatch $addressPattern -or $CanaryCollection -eq $zero) {
    throw "Invalid or zero canary collection: $CanaryCollection"
}
if (-not ($Collections | Where-Object { $_.ToLowerInvariant() -eq $CanaryCollection.ToLowerInvariant() })) {
    throw "CanaryCollection must be included in Collections"
}
if ($OfflineTemplate -and $RpcUrl) { throw "OfflineTemplate cannot be combined with RpcUrl" }
if (-not $OfflineTemplate) {
    if ([string]::IsNullOrWhiteSpace($RpcUrl)) { throw "RpcUrl is required unless OfflineTemplate is explicitly selected" }
    if ($Coordinator -notmatch $addressPattern -or $Coordinator -eq $zero) { throw "A non-zero Coordinator is required for RPC validation" }
}

function Get-Calldata([string]$Signature, [string[]]$Arguments) {
    $result = & $cast calldata $Signature @Arguments
    if ($LASTEXITCODE -ne 0) { throw "cast calldata failed for $Signature" }
    return ($result -join "").Trim()
}

function Invoke-Cast([string[]]$Arguments, [string]$Description) {
    $result = & $cast @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "cast failed while $Description`: $($result -join ' ')" }
    return ($result -join "").Trim()
}

function Get-View([string]$Address, [string]$Signature) {
    return Invoke-Cast @("call", $Address, $Signature, "--rpc-url", $RpcUrl) "reading $Signature at $Address"
}

function Get-Code([string]$Address) {
    return Invoke-Cast @("code", $Address, "--rpc-url", $RpcUrl) "reading bytecode at $Address"
}

$onchain = [ordered]@{
    performed = $false
    chainId = $null
    owner = $null
    rewardsBound = $false
    activationReady = $false
    checks = @()
}
$activationReady = $false
$splitFrozen = $false
$revenueReady = $false

if (-not $OfflineTemplate) {
    $chainId = Invoke-Cast @("chain-id", "--rpc-url", $RpcUrl) "reading chain id"
    if ([uint64]$chainId -ne 999) { throw "RPC chain id must be 999, got $chainId" }
    foreach ($address in @($Fwa, $Whitelist, $Rewards, $Token, $Splitter, $Coordinator)) {
        if ((Get-Code $address) -eq "0x") { throw "Missing deployed bytecode at $address" }
    }

    $safeOwner = (Get-View $Fwa "owner()(address)").ToLowerInvariant()
    if ($safeOwner -eq $zero -or (Get-Code $safeOwner) -eq "0x") { throw "FWA owner must be a deployed Safe contract" }
    foreach ($owned in @($Whitelist, $Rewards, $Token, $Splitter, $Coordinator)) {
        $actualOwner = (Get-View $owned "owner()(address)").ToLowerInvariant()
        if ($actualOwner -ne $safeOwner) { throw "Owner mismatch at $owned`: expected $safeOwner, got $actualOwner" }
    }

    $boundRewards = (Get-View $Fwa "rewards()(address)").ToLowerInvariant()
    $expectedRewards = $Rewards.ToLowerInvariant()
    if ($boundRewards -ne $zero -and $boundRewards -ne $expectedRewards) {
        throw "FWA rewards is already bound to an unexpected module: $boundRewards"
    }
    $rewardsBound = $boundRewards -eq $expectedRewards
    if ((Get-View $Fwa "acquisitionsEnabled()(bool)") -ne "false") { throw "Acquisitions must be closed" }
    if ((Get-View $Fwa "withdrawOnly()(bool)") -ne "false") { throw "Withdraw-only mode must be clear before launch" }
    if ([System.Numerics.BigInteger](Get-View $Fwa "activeListingCount()(uint256)") -ne 0) { throw "Active pool must be empty" }
    if ([System.Numerics.BigInteger](Get-View $Fwa "stagedCount()(uint256)") -ne 0) { throw "Staging queue must be empty" }
    if ([System.Numerics.BigInteger](Get-View $Rewards "emissionStart()(uint256)") -ne 0) { throw "Rewards emission already started" }
    if ((Get-View $Token "externalBuysEnabled()(bool)") -ne "false") { throw "External token buys must be closed" }

    $splitFrozen = (Get-View $Splitter "splitFrozen()(bool)") -eq "true"
    $revenueReady = (Get-View $Splitter "revenueReady()(bool)") -eq "true"
    if ($revenueReady -and -not $splitFrozen) { throw "Invalid Splitter state: revenue ready without frozen split" }
    $drandReady = (Get-View $Coordinator "launchReady()(bool)") -eq "true"
    $activationReady = $rewardsBound -and $drandReady

    $onchain = [ordered]@{
        performed = $true
        chainId = 999
        owner = $safeOwner
        rewardsBound = $rewardsBound
        drandLaunchReady = $drandReady
        splitFrozen = $splitFrozen
        revenueReady = $revenueReady
        acquisitionsClosed = $true
        externalBuysClosed = $true
        poolEmpty = $true
        emissionNotStarted = $true
        activationReady = $activationReady
        checkedAtUtc = [DateTime]::UtcNow.ToString("o")
    }
}

$canaryCollectionArg = "[$CanaryCollection]"
$publicCollections = @($Collections | Where-Object { $_.ToLowerInvariant() -ne $CanaryCollection.ToLowerInvariant() })
$publicCollectionArg = "[" + ($publicCollections -join ",") + "]"
$preActivation = [ordered]@{
        to = $Fwa
        value = "0"
        data = Get-Calldata "setRewards(address)" @($Rewards)
        operation = 0
        description = "Bind the audited rewards module while acquisitions and emissions are still closed"
    }
$activationTemplate = @(
    [ordered]@{
        order = 1
        to = $Splitter
        value = "0"
        data = Get-Calldata "freezeSplit()" @()
        operation = 0
        description = "Permanently freeze the audited 70/30 revenue split"
    },
    [ordered]@{
        order = 2
        to = $Splitter
        value = "0"
        data = Get-Calldata "startRevenueClock()" @()
        operation = 0
        description = "Start the holder claim window at launch rather than infrastructure deployment"
    },
    [ordered]@{
        order = 3
        to = $Whitelist
        value = "0"
        data = Get-Calldata "setCollections(address[],bool)" @($canaryCollectionArg, "true")
        operation = 0
        description = "Allowlist only the reviewed canary ERC-721 collection"
    },
    [ordered]@{
        order = 4
        to = $Fwa
        value = "0"
        data = Get-Calldata "setBool(uint256,bool)" @("41", "true")
        operation = 0
        description = "Open FWA acquisitions and start rewards emission"
    }
)

$activation = @()
if ($OfflineTemplate) {
    $activation = $activationTemplate
} elseif ($activationReady) {
    $nextOrder = 1
    if (-not $splitFrozen) {
        $activation += $activationTemplate[0]
        $activation[-1].order = $nextOrder++
    }
    if (-not $revenueReady) {
        $activation += $activationTemplate[1]
        $activation[-1].order = $nextOrder++
    }
    foreach ($item in @($activationTemplate[2], $activationTemplate[3])) {
        $activation += $item
        $activation[-1].order = $nextOrder++
    }
}

$emergencyPause = @(
    [ordered]@{
        order = 1
        to = $Fwa
        value = "0"
        data = Get-Calldata "setBool(uint256,bool)" @("41", "false")
        operation = 0
        description = "Close new acquisitions"
    },
    [ordered]@{
        order = 2
        to = $Fwa
        value = "0"
        data = Get-Calldata "setBool(uint256,bool)" @("42", "true")
        operation = 0
        description = "Enter withdraw-only mode while canonical in-flight settlement remains processable"
    },
    [ordered]@{
        order = 3
        to = $Token
        value = "0"
        data = Get-Calldata "setExternalBuysEnabled(bool)" @("false")
        operation = 0
        description = "Close public Project X buys"
    }
)

$manualTradingControls = [ordered]@{
    open = [ordered]@{
        to = $Token
        value = "0"
        data = Get-Calldata "setExternalBuysEnabled(bool)" @("true")
        operation = 0
        description = "Manually enable public Project X pool buys"
    }
    close = [ordered]@{
        to = $Token
        value = "0"
        data = Get-Calldata "setExternalBuysEnabled(bool)" @("false")
        operation = 0
        description = "Manually disable public Project X pool buys"
    }
}

$postCanaryTemplate = @()
if ($publicCollections.Count -ne 0) {
    $postCanaryTemplate = @(
        [ordered]@{
            to = $Whitelist
            value = "0"
            data = Get-Calldata "setCollections(address[],bool)" @($publicCollectionArg, "true")
            operation = 0
            description = "NON-EXECUTABLE TEMPLATE: allowlist reviewed public collections only after a fulfilled canary acquisition"
        }
    )
}

$payload = [ordered]@{
    schemaVersion = 2
    chainId = 999
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    broadcast = $false
    executable = (-not $OfflineTemplate -and $activationReady)
    onchainValidation = $onchain
    preActivation = $preActivation
    activationBatch = $activation
    activationTemplate = $activationTemplate
    canaryCollection = $CanaryCollection
    postCanaryPublicCollectionsTemplate = $postCanaryTemplate
    postCanaryPublicCollectionsExecutable = $false
    emergencyPause = $emergencyPause
    manualTradingControls = $manualTradingControls
    notes = @(
        "This file contains calldata only and never broadcasts.",
        "Execute preActivation first, then verify Project X/core wiring and complete closed-market E2E.",
        "Re-run this script with the chain-999 RPC after preActivation; only an RPC-validated output is executable.",
        "Execute activationBatch in order only after source, drand-BN254, Project X and closed-market attestations; it allowlists only the canary collection.",
        "The post-canary template is deliberately non-executable. PreparePostCanaryCollections.ps1 must attest one exact Fulfilled acquisition before public collections are enabled.",
        "The core independently rejects acquisition opening until rewards, recent drand proof and splitter readiness are all on-chain.",
        "Public token buys are deliberately not part of activationBatch; use the separate manual open/close action."
    )
}

$resolved = Join-Path $projectRoot $OutputPath
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolved) | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($resolved, ($payload | ConvertTo-Json -Depth 10), $utf8NoBom)
Write-Host "Prepared non-broadcast owner actions at $resolved"
