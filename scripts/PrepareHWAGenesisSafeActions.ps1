param(
    [Parameter(Mandatory = $true)] [string]$Collection,
    [Parameter(Mandatory = $true)] [string]$BaseUri,
    [string]$Safe = "0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C",
    [string]$CustodyPath = "release/hwa-genesis-custody-recipients.json",
    [string]$RpcUrl,
    [switch]$OfflineTemplate,
    [string]$OutputPath = "release/hwa-genesis-safe-actions.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$cast = Join-Path $projectRoot ".tools\foundry\cast.exe"
if (-not (Test-Path -LiteralPath $cast)) { throw "Foundry cast not found at $cast" }
$addressPattern = '^0x[0-9a-fA-F]{40}$'
$zero = "0x0000000000000000000000000000000000000000"
foreach ($address in @($Collection, $Safe)) {
    if ($address -notmatch $addressPattern -or $address -eq $zero) { throw "Invalid or zero address: $address" }
}
if ($OfflineTemplate -and $RpcUrl) { throw "OfflineTemplate cannot be combined with RpcUrl" }
if (-not $OfflineTemplate -and [string]::IsNullOrWhiteSpace($RpcUrl)) {
    throw "RpcUrl is required unless OfflineTemplate is explicitly selected"
}

$approvedAggregate = "96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648"
$uri = $null
if (-not [Uri]::TryCreate($BaseUri, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne "https" `
    -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
    throw "BaseUri must be an absolute credential-free HTTPS URL"
}
$expectedSuffix = "/hwa-genesis/v3/$approvedAggregate/metadata/"
if (-not $uri.AbsolutePath.EndsWith($expectedSuffix, [StringComparison]::Ordinal)) {
    throw "BaseUri must end with the approved immutable Genesis v3 metadata path"
}

function Invoke-Cast([string[]]$Arguments, [string]$Description) {
    $result = & $cast @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "cast failed while $Description`: $($result -join ' ')" }
    return ($result -join "").Trim()
}

function Get-View([string]$Signature) {
    return Invoke-Cast @("call", $Collection, $Signature, "--rpc-url", $RpcUrl) "reading $Signature"
}

$custodyResolved = if ([IO.Path]::IsPathRooted($CustodyPath)) { $CustodyPath } else { Join-Path $projectRoot $CustodyPath }
if (-not (Test-Path -LiteralPath $custodyResolved -PathType Leaf)) { throw "Missing custody artifact: $custodyResolved" }
$custody = Get-Content -LiteralPath $custodyResolved -Raw | ConvertFrom-Json
if ($custody.schemaVersion -ne 1 -or $custody.collection.supply -ne 333 `
    -or $custody.collection.initialCustodian.ToLowerInvariant() -ne $Safe.ToLowerInvariant()) {
    throw "Custody artifact does not match the frozen 333-token Safe allocation"
}
$batches = @($custody.mintBatches)
if ($batches.Count -ne 4 -or (($batches | ForEach-Object { [int]$_.count }) -join ",") -ne "100,100,100,33") {
    throw "Custody batches must be exactly 100/100/100/33"
}
$seen = 0
foreach ($batch in $batches) {
    foreach ($recipient in @($batch.recipients)) {
        if ($recipient.ToLowerInvariant() -ne $Safe.ToLowerInvariant()) { throw "Unexpected Genesis mint recipient" }
        $seen++
    }
}
if ($seen -ne 333) { throw "Custody artifact contains $seen recipients, expected 333" }

$validation = [ordered]@{ performed = $false; chainId = $null; checks = @() }
$executable = $false
if (-not $OfflineTemplate) {
    $chainId = Invoke-Cast @("chain-id", "--rpc-url", $RpcUrl) "reading chain id"
    if ([uint64]$chainId -ne 999) { throw "RPC chain id must be 999, got $chainId" }
    $code = Invoke-Cast @("code", $Collection, "--rpc-url", $RpcUrl) "reading collection bytecode"
    if ($code -eq "0x") { throw "Genesis collection is not deployed" }
    if ((Get-View "owner()(address)").ToLowerInvariant() -ne $Safe.ToLowerInvariant()) { throw "Genesis owner is not the frozen Safe" }
    if ([int](Get-View "maxSupply()(uint256)") -ne 333) { throw "Genesis max supply must be 333" }
    if ([int](Get-View "currentSupply()(uint256)") -ne 0) { throw "Genesis Safe action package requires a fresh zero-supply collection" }
    if ([int](Get-View "highestMintedTokenId()(uint256)") -ne 0) { throw "Genesis token sequence is not fresh" }
    if ((Get-View "snapshotFrozen()(bool)") -ne "false") { throw "Genesis snapshot is already frozen" }
    $onchainBaseUriRaw = Get-View "baseURI()(string)"
    # `cast call` renders a dynamic Solidity string as a JSON-quoted scalar. Decode that
    # representation before comparing it with the remotely attested URI; fixed-width values
    # such as addresses, integers and booleans above are emitted without quotes.
    $onchainBaseUri = if ($onchainBaseUriRaw.StartsWith('"') -and $onchainBaseUriRaw.EndsWith('"')) {
        $onchainBaseUriRaw | ConvertFrom-Json
    } else {
        $onchainBaseUriRaw
    }
    if ($onchainBaseUri -cne $BaseUri) { throw "Genesis base URI differs from the remotely attested URI" }
    $validation = [ordered]@{
        performed = $true
        chainId = 999
        owner = $Safe
        maxSupply = 333
        currentSupply = 0
        highestMintedTokenId = 0
        snapshotFrozen = $false
        baseUri = $BaseUri
        checkedAtUtc = [DateTime]::UtcNow.ToString("o")
    }
    $executable = $true
}

$actions = @()
$order = 1
foreach ($batch in $batches) {
    $recipientArgument = "[" + (@($batch.recipients) -join ",") + "]"
    $actions += [ordered]@{
        order = $order++
        to = $Collection
        value = "0"
        data = Invoke-Cast @("calldata", "batchMint(address[])", $recipientArgument) "encoding Genesis batch mint"
        operation = 0
        description = "Mint Genesis token IDs $($batch.firstTokenId)-$($batch.lastTokenId) to initial Safe custody"
    }
}
$actions += [ordered]@{
    order = $order
    to = $Collection
    value = "0"
    data = Invoke-Cast @("calldata", "freezeSnapshot()") "encoding Genesis snapshot freeze"
    operation = 0
    description = "Permanently freeze the 333-token Genesis supply and approved HTTPS metadata prefix"
}

$payload = [ordered]@{
    schemaVersion = 1
    chainId = 999
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    broadcast = $false
    executable = $executable
    collection = $Collection
    safe = $Safe
    approvedSourceArtAggregateSha256 = $approvedAggregate
    baseUri = $BaseUri
    onchainValidation = $validation
    actions = $actions
    postConditions = @(
        "currentSupply == 333",
        "highestMintedTokenId == 333",
        "snapshotFrozen == true",
        "baseURI is unchanged",
        "ownerOf(1..333) == Safe before community distribution"
    )
    notes = @(
        "This file contains calldata only and never broadcasts.",
        "Review all five actions, then execute them in order through the 2-of-3 Safe.",
        "Run VerifyHWAGenesisOnchain.ps1 after execution and before deploying SplitterHyperEVM."
    )
}

$resolvedOutput = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $projectRoot $OutputPath }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutput) | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($resolvedOutput, ($payload | ConvertTo-Json -Depth 12), $utf8NoBom)
Write-Host "Prepared five non-broadcast Genesis Safe actions at $resolvedOutput"
Write-Host "Executable: $executable"
