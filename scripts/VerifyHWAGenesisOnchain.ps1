param(
    [Parameter(Mandatory = $true)] [string]$Collection,
    [Parameter(Mandatory = $true)] [string]$BaseUri,
    [Parameter(Mandatory = $true)] [string]$RpcUrl,
    [string]$Safe = "0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C",
    [string]$OutputPath = "release/hwa-genesis-onchain-attestation.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$cast = Join-Path $projectRoot ".tools\foundry\cast.exe"
if (-not (Test-Path -LiteralPath $cast)) { throw "Foundry cast not found at $cast" }
$addressPattern = '^0x[0-9a-fA-F]{40}$'
foreach ($address in @($Collection, $Safe)) {
    if ($address -notmatch $addressPattern) { throw "Invalid address: $address" }
}

function Invoke-Cast([string[]]$Arguments, [string]$Description) {
    $result = & $cast @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "cast failed while $Description`: $($result -join ' ')" }
    return ($result -join "").Trim()
}
function Get-View([string]$Signature, [string[]]$Arguments = @()) {
    return Invoke-Cast (@("call", $Collection, $Signature) + $Arguments + @("--rpc-url", $RpcUrl)) "reading $Signature"
}

$chainId = Invoke-Cast @("chain-id", "--rpc-url", $RpcUrl) "reading chain id"
if ([uint64]$chainId -ne 999) { throw "RPC chain id must be 999, got $chainId" }
if ((Invoke-Cast @("code", $Collection, "--rpc-url", $RpcUrl) "reading collection bytecode") -eq "0x") {
    throw "Genesis collection is not deployed"
}
if ((Get-View "owner()(address)").ToLowerInvariant() -ne $Safe.ToLowerInvariant()) { throw "Genesis owner mismatch" }
if ([int](Get-View "maxSupply()(uint256)") -ne 333) { throw "Genesis max supply mismatch" }
if ([int](Get-View "currentSupply()(uint256)") -ne 333) { throw "Genesis current supply mismatch" }
if ([int](Get-View "highestMintedTokenId()(uint256)") -ne 333) { throw "Genesis highest token mismatch" }
if ((Get-View "snapshotFrozen()(bool)") -ne "true") { throw "Genesis snapshot is not frozen" }
if ((Get-View "mintingClosed()(bool)") -ne "true" -or (Get-View "metadataFrozen()(bool)") -ne "true") {
    throw "Genesis minting and metadata must both be closed"
}
if ((Get-View "baseURI()(string)") -ne $BaseUri) { throw "Genesis base URI mismatch" }
if ((Get-View "tokenURI(uint256)(string)" @("1")) -ne ($BaseUri + "1") `
    -or (Get-View "tokenURI(uint256)(string)" @("333")) -ne ($BaseUri + "333")) {
    throw "Genesis endpoint token URIs mismatch"
}

for ($tokenId = 1; $tokenId -le 333; $tokenId++) {
    $owner = Get-View "ownerOf(uint256)(address)" @([string]$tokenId)
    if ($owner.ToLowerInvariant() -ne $Safe.ToLowerInvariant()) { throw "Token $tokenId is not in initial Safe custody" }
}

$payload = [ordered]@{
    schemaVersion = 1
    result = "passed"
    chainId = 999
    verifiedAtUtc = [DateTime]::UtcNow.ToString("o")
    collection = $Collection
    safe = $Safe
    supply = 333
    ownersVerified = 333
    snapshotFrozen = $true
    baseUri = $BaseUri
    approvedSourceArtAggregateSha256 = "96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648"
    broadcastPerformed = $false
    splitterDeploymentAllowed = $true
}
$resolvedOutput = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $projectRoot $OutputPath }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutput) | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($resolvedOutput, ($payload | ConvertTo-Json -Depth 5), $utf8NoBom)
Write-Host "Verified all 333 Genesis tokens, immutable metadata and Safe custody."
Write-Host "No transaction was broadcast. Attestation: $resolvedOutput"
