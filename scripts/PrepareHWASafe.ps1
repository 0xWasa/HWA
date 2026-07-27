param(
    [string]$Signer1 = "0x645b7e2A32cfF5e131a3D6Cf16155e006fe74F5c",
    [string]$Signer2 = "0x487F29A5C4eE0669D40d77Cd78F5b6A95046fECB",
    [string]$Signer3 = "0x10B327d693F223399F2D8151B2B97a66818FF681",
    [string]$RpcUrl = "https://rpc.hyperliquid.xyz/evm",
    [string]$OutputPath = "release/hwa-safe-mainnet-preparation.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$cast = Join-Path $projectRoot ".tools\foundry\cast.exe"
if (-not (Test-Path -LiteralPath $cast)) { throw "Foundry cast not found at $cast" }

$singleton = "0x41675C099F32341bf84BFc5382aF534df5C7461a"
$proxyFactory = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"
$fallbackHandler = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99"
$expectedCodeHashes = [ordered]@{
    singleton = "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4"
    proxyFactory = "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317"
    fallbackHandler = "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9"
}
$threshold = 2
$zero = "0x0000000000000000000000000000000000000000"
$addressPattern = '^0x[0-9a-fA-F]{40}$'

function Invoke-Cast([string[]]$Arguments, [string]$Description) {
    $result = & $cast @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "cast failed while $Description`: $($result -join ' ')" }
    return ($result -join "").Trim()
}

function Get-Code([string]$Address) {
    return Invoke-Cast @("code", $Address, "--rpc-url", $RpcUrl) "reading code at $Address"
}

function Get-HexKeccak([string]$Data, [string]$Description) {
    # Safe's singleton runtime exceeds Windows' command-line length. Feeding canonical hex on
    # stdin keeps the hash local and avoids writing bytecode to disk or trusting an RPC hash method.
    $result = $Data | & $cast keccak 2>&1
    if ($LASTEXITCODE -ne 0) { throw "cast keccak failed while $Description`: $($result -join ' ')" }
    return ($result -join "").Trim()
}

function Get-CodeHash([string]$Address) {
    return Get-HexKeccak (Get-Code $Address) "hashing code at $Address"
}

$chainId = [uint64](Invoke-Cast @("chain-id", "--rpc-url", $RpcUrl) "reading chain id")
if ($chainId -ne 999) { throw "Expected HyperEVM mainnet chain 999, got $chainId" }

$owners = @($Signer1, $Signer2, $Signer3)
if (($owners | Select-Object -Unique).Count -ne 3) { throw "Safe owners must be distinct" }
foreach ($owner in $owners) {
    if ($owner -notmatch $addressPattern -or $owner -eq $zero) { throw "Invalid Safe owner: $owner" }
    $checksum = Invoke-Cast @("to-check-sum-address", $owner) "checksumming $owner"
    if ($checksum -cne $owner) { throw "Safe owner is not checksummed exactly: $owner (expected $checksum)" }
    if ((Get-Code $owner) -ne "0x") { throw "Safe owner must be an EOA at preparation time: $owner" }
}

$canonical = [ordered]@{
    singleton = [ordered]@{ address = $singleton; codeHash = Get-CodeHash $singleton }
    proxyFactory = [ordered]@{ address = $proxyFactory; codeHash = Get-CodeHash $proxyFactory }
    fallbackHandler = [ordered]@{ address = $fallbackHandler; codeHash = Get-CodeHash $fallbackHandler }
}
foreach ($name in $expectedCodeHashes.Keys) {
    if ($canonical[$name].codeHash -ne $expectedCodeHashes[$name]) {
        throw "Canonical Safe $name code hash mismatch"
    }
}

$ownerArgument = "[" + ($owners -join ",") + "]"
$initializer = Invoke-Cast @(
    "calldata", "setup(address[],uint256,address,bytes,address,address,uint256,address)",
    $ownerArgument, "$threshold", $zero, "0x", $fallbackHandler, $zero, "0", $zero
) "encoding Safe initializer"
$saltNonceHex = Invoke-Cast @("keccak", "HWA_SAFE_HYPEREVM_MAINNET_V1") "deriving Safe salt nonce"
$saltNonce = [System.Numerics.BigInteger]::Parse(
    "0" + $saltNonceHex.Substring(2), [System.Globalization.NumberStyles]::HexNumber
)
$initializerHash = Get-HexKeccak $initializer "hashing Safe initializer"
$saltEncoded = Invoke-Cast @("abi-encode", "f(bytes32,uint256)", $initializerHash, "$saltNonce") "encoding CREATE2 salt"
$salt = Get-HexKeccak $saltEncoded "hashing CREATE2 salt"
$creationCode = Invoke-Cast @(
    "call", $proxyFactory, "proxyCreationCode()(bytes)", "--rpc-url", $RpcUrl
) "reading Safe proxy creation code"
$singletonArgument = Invoke-Cast @("abi-encode", "f(address)", $singleton) "encoding singleton constructor argument"
$deploymentData = "0x" + $creationCode.Substring(2) + $singletonArgument.Substring(2)
$deploymentHash = Get-HexKeccak $deploymentData "hashing Safe proxy deployment data"
$create2Preimage = "0xff" + $proxyFactory.Substring(2).ToLowerInvariant() + $salt.Substring(2) + $deploymentHash.Substring(2)
$create2Hash = Get-HexKeccak $create2Preimage "deriving Safe proxy address"
$predictedRaw = "0x" + $create2Hash.Substring($create2Hash.Length - 40)
$predictedSafe = Invoke-Cast @("to-check-sum-address", $predictedRaw) "checksumming predicted Safe"
if ((Get-Code $predictedSafe) -ne "0x") { throw "Predicted Safe is already deployed: $predictedSafe" }

$deploymentCalldata = Invoke-Cast @(
    "calldata", "createProxyWithNonce(address,bytes,uint256)", $singleton, $initializer, "$saltNonce"
) "encoding Safe proxy deployment transaction"
$headBlock = [uint64](Invoke-Cast @("block-number", "--rpc-url", $RpcUrl) "reading head block")

$report = [ordered]@{
    schemaVersion = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    status = "prepared-not-broadcast"
    chainId = $chainId
    verifiedAtBlock = $headBlock
    safeVersion = "1.4.1"
    predictedSafe = $predictedSafe
    owners = $owners
    threshold = $threshold
    saltNonce = "$saltNonce"
    initializerHash = $initializerHash
    create2Salt = $salt
    canonical = $canonical
    configuration = [ordered]@{
        modules = @()
        guard = $zero
        setupDelegatecallTarget = $zero
        fallbackHandler = $fallbackHandler
        paymentToken = $zero
        payment = "0"
    }
    deploymentTransaction = [ordered]@{
        to = $proxyFactory
        value = "0"
        data = $deploymentCalldata
        operation = 0
    }
    checks = @(
        "chain-999",
        "canonical-code-hashes",
        "three-distinct-checksummed-eoa-owners",
        "threshold-2",
        "no-modules-no-guard-no-setup-delegatecall",
        "predicted-address-empty"
    )
}

$resolvedOutput = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $projectRoot $OutputPath }
$directory = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
Write-Host "Prepared HWA Safe $predictedSafe (2-of-3) without broadcast."
Write-Host "Artifact: $resolvedOutput"
