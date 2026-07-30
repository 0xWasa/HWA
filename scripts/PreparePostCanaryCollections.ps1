param(
    [Parameter(Mandatory = $true)] [string]$Fwa,
    [Parameter(Mandatory = $true)] [string]$Whitelist,
    [Parameter(Mandatory = $true)] [string]$Coordinator,
    [Parameter(Mandatory = $true)] [string]$CanaryCollection,
    [Parameter(Mandatory = $true)] [string]$CanaryRequestId,
    [Parameter(Mandatory = $true)] [string[]]$PublicCollections,
    [Parameter(Mandatory = $true)] [string]$ExpectedOwner,
    [switch]$EoaOwnerRiskAccepted,
    [Parameter(Mandatory = $true)] [string]$RpcUrl,
    [string]$OutputPath = "release/mainnet-post-canary-collections.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$cast = Join-Path $projectRoot ".tools\foundry\cast.exe"
if (-not (Test-Path -LiteralPath $cast)) { throw "Foundry cast not found at $cast" }

$addressPattern = '^0x[0-9a-fA-F]{40}$'
$zero = "0x0000000000000000000000000000000000000000"
$zeroBytes32 = "0x" + ("0" * 64)
foreach ($address in @($Fwa, $Whitelist, $Coordinator, $CanaryCollection) + $PublicCollections) {
    if ($address -notmatch $addressPattern -or $address -eq $zero) { throw "Invalid or zero address: $address" }
}
if ($PublicCollections.Count -eq 0) { throw "At least one public collection is required" }
if ($CanaryRequestId -match '^0[xX]([0-9a-fA-F]{1,64})$') {
    $requestId = [System.Numerics.BigInteger]::Parse(
        "0" + $Matches[1],
        [System.Globalization.NumberStyles]::AllowHexSpecifier,
        [System.Globalization.CultureInfo]::InvariantCulture
    )
} elseif ($CanaryRequestId -match '^[0-9]+$') {
    $requestId = [System.Numerics.BigInteger]::Parse(
        $CanaryRequestId,
        [System.Globalization.CultureInfo]::InvariantCulture
    )
} else {
    throw "CanaryRequestId must be a decimal or 0x-prefixed uint256"
}
if ($requestId -le 0) { throw "CanaryRequestId must be a positive uint256" }
$requestIdArg = $requestId.ToString([System.Globalization.CultureInfo]::InvariantCulture)

function Invoke-Cast([string[]]$Arguments, [string]$Description) {
    $result = & $cast @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "cast failed while $Description`: $($result -join ' ')" }
    return @($result | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
}

function Get-View([string]$Address, [string]$Signature, [string[]]$Arguments = @()) {
    return (Invoke-Cast (@("call", $Address, $Signature) + $Arguments + @("--rpc-url", $RpcUrl)) "reading $Signature at $Address") -join "`n"
}

function Get-Code([string]$Address) {
    return (Invoke-Cast @("code", $Address, "--rpc-url", $RpcUrl) "reading bytecode at $Address") -join ""
}

function Get-Calldata([string]$Signature, [string[]]$Arguments) {
    return (Invoke-Cast (@("calldata", $Signature) + $Arguments) "encoding $Signature") -join ""
}

$chainId = (Invoke-Cast @("chain-id", "--rpc-url", $RpcUrl) "reading chain id") -join ""
if ([uint64]$chainId -ne 999) { throw "RPC chain id must be 999, got $chainId" }
foreach ($address in @($Fwa, $Whitelist, $Coordinator, $CanaryCollection) + $PublicCollections) {
    if ((Get-Code $address) -eq "0x") { throw "Missing deployed bytecode at $address" }
}

$owner = (Get-View $Fwa "owner()(address)").ToLowerInvariant()
$expectedOwnerNormalized = $ExpectedOwner.ToLowerInvariant()
if ($ExpectedOwner -notmatch $addressPattern -or $ExpectedOwner -eq $zero -or $owner -ne $expectedOwnerNormalized) {
    throw "FWA owner does not match ExpectedOwner"
}
if ((Get-Code $owner) -eq "0x" -and -not $EoaOwnerRiskAccepted) {
    throw "EOA ownership requires -EoaOwnerRiskAccepted"
}
foreach ($owned in @($Whitelist, $Coordinator)) {
    $actualOwner = (Get-View $owned "owner()(address)").ToLowerInvariant()
    if ($actualOwner -ne $owner) { throw "Owner mismatch at $owned`: expected $owner, got $actualOwner" }
}

if ((Get-View $Fwa "acquisitionsEnabled()(bool)") -ne "true") { throw "Canary acquisitions must still be enabled" }
if ((Get-View $Fwa "withdrawOnly()(bool)") -ne "false") { throw "Core is in withdraw-only mode" }
if ((Get-View $Fwa "collectionWhitelisted(address)(bool)" @($CanaryCollection)) -ne "true") {
    throw "Canary collection is not allowlisted"
}
if ([System.Numerics.BigInteger](Get-View $Fwa "lastIssuedSequence()(uint64)") -le 0) {
    throw "No FWA acquisition has ever been issued"
}
if ([System.Numerics.BigInteger](Get-View $Fwa "pendingAcquisitionCount()(uint256)") -ne 0 -or
    [System.Numerics.BigInteger](Get-View $Fwa "unsettledAcquisitionCount()(uint256)") -ne 0) {
    throw "Canary acquisition processing is not fully terminal"
}
if ([System.Numerics.BigInteger](Get-View $Coordinator "requestCount()(uint64)") -le 0 -or
    [System.Numerics.BigInteger](Get-View $Coordinator "pendingRequestCount()(uint256)") -ne 0) {
    throw "Coordinator has no completed request history or still has pending requests"
}

$acquisitionLines = Invoke-Cast @(
    "call", $Fwa, "acquisitions(uint256)(address,uint256,uint256,uint256,uint8)", $requestIdArg,
    "--rpc-url", $RpcUrl
) "reading the canary acquisition"
if ($acquisitionLines.Count -lt 5) { throw "Unexpected acquisitions() response: $($acquisitionLines -join ' | ')" }
$statusText = $acquisitionLines[-1]
if ($statusText -notmatch '^([0-9]+)') { throw "Could not parse canary status from: $statusText" }
if ([uint64]$Matches[1] -ne 2) { throw "Canary request is not Fulfilled (status=2); got $statusText" }

$beaconRandomness = (Get-View $Coordinator "fulfilledBeaconRandomness(uint256)(bytes32)" @($requestIdArg)).ToLowerInvariant()
if ($beaconRandomness -eq $zeroBytes32) { throw "No verified drand beacon randomness cached for canary request" }

$collectionsToEnable = @()
foreach ($collection in $PublicCollections) {
    if ($collection.ToLowerInvariant() -eq $CanaryCollection.ToLowerInvariant()) {
        throw "CanaryCollection must not be repeated in PublicCollections"
    }
    $enabled = Get-View $Fwa "collectionWhitelisted(address)(bool)" @($collection)
    if ($enabled -eq "true") { throw "Public collection is already enabled: $collection" }
    $collectionsToEnable += $collection
}

$collectionArg = "[" + ($collectionsToEnable -join ",") + "]"
$action = [ordered]@{
    to = $Whitelist
    value = "0"
    data = Get-Calldata "setCollections(address[],bool)" @($collectionArg, "true")
    operation = 0
    description = "Allowlist reviewed public ERC-721 collections after a proven successful canary acquisition"
}

$payload = [ordered]@{
    schemaVersion = 1
    chainId = 999
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    broadcast = $false
    executable = $true
    owner = $owner
    canaryProof = [ordered]@{
        collection = $CanaryCollection
        requestId = $requestIdArg
        acquisitionStatus = "Fulfilled"
        beaconRandomness = $beaconRandomness
        noPendingCoordinatorRequests = $true
        noPendingOrUnsettledCoreAcquisitions = $true
        checkedAtUtc = [DateTime]::UtcNow.ToString("o")
    }
    publicCollections = $collectionsToEnable
    action = $action
    notes = @(
        "This file contains calldata only and never broadcasts.",
        "The exact canary request was read from FWA as Fulfilled and linked to cached drand beacon randomness.",
        "Re-run this script immediately before owner execution; do not execute stale output."
    )
}

$resolved = Join-Path $projectRoot $OutputPath
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolved) | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($resolved, ($payload | ConvertTo-Json -Depth 10), $utf8NoBom)
Write-Host "Prepared RPC-attested post-canary collection action at $resolved"
