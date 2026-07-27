param(
    [string]$Path = ".env.mainnet.local",
    [switch]$FinalizeDeployedSafe,
    [string]$RpcUrl = "https://rpc.hyperliquid.xyz/evm"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedPath = if ([IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $projectRoot $Path }
if (-not (Test-Path -LiteralPath $resolvedPath)) { throw "Mainnet env file not found: $resolvedPath" }

$zero = "0x0000000000000000000000000000000000000000"
$safe = "0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C"
$ownerRecipient = $zero
$safeConfirmed = "false"
if ($FinalizeDeployedSafe) {
    $cast = Join-Path $projectRoot ".tools\foundry\cast.exe"
    if (-not (Test-Path -LiteralPath $cast)) { throw "Foundry cast not found at $cast" }
    $chainId = (& $cast chain-id --rpc-url $RpcUrl 2>&1 | Out-String).Trim()
    $code = (& $cast code $safe --rpc-url $RpcUrl 2>&1 | Out-String).Trim()
    $threshold = (& $cast call $safe "getThreshold()(uint256)" --rpc-url $RpcUrl 2>&1 | Out-String).Trim()
    $owners = (& $cast call $safe "getOwners()(address[])" --rpc-url $RpcUrl 2>&1 | Out-String).Trim().ToLowerInvariant()
    if (
        $chainId -ne "999" -or $code -eq "0x" -or $threshold -ne "2" -or
        -not $owners.Contains("0x645b7e2a32cff5e131a3d6cf16155e006fe74f5c") -or
        -not $owners.Contains("0x487f29a5c4ee0669d40d77cd78f5b6a95046fecb") -or
        -not $owners.Contains("0x10b327d693f223399f2d8151b2b97a66818ff681")
    ) { throw "The deployed HWA Safe failed its chain-999 owner/threshold attestation" }
    $ownerRecipient = $safe
    $safeConfirmed = "true"
}
$publicValues = [ordered]@{
    FWA_CHAIN_ID = "999"
    HWA_SAFE_DEPLOYMENT_CONFIRMED = $safeConfirmed
    HWA_SAFE_SIGNER_1 = "0x645b7e2A32cfF5e131a3D6Cf16155e006fe74F5c"
    HWA_SAFE_SIGNER_2 = "0x487F29A5C4eE0669D40d77Cd78F5b6A95046fECB"
    HWA_SAFE_SIGNER_3 = "0x10B327d693F223399F2D8151B2B97a66818FF681"
    HWA_SAFE_THRESHOLD = "2"
    HWA_SAFE_PREDICTED_ADDRESS = $safe
    HWA_SAFE_SALT_NONCE = "86676891632942773236344265692712563299257346711408074622853684666603124754373"
    # These stay fail-closed unless -FinalizeDeployedSafe passes its live chain-999 attestation.
    FWA_OWNER = $ownerRecipient
    FWA_SPLITTER_SECONDARY_OWNER = $zero
    FWA_PROJECTX_FEE_RECIPIENT = $ownerRecipient
    FWA_LEGACY_ALLOCATION_RECIPIENT = $ownerRecipient
    HWA_GENESIS_NFT_MAX_SUPPLY = "333"
    HWA_MAINNET_OPERATIONAL_BUDGET_WEI = "20000000000000000000"
    MAINNET_FWA_MIN_INITIAL_FDV_HYPE_WEI = "600000000000000000000"
    MAINNET_FWA_MAX_INITIAL_FDV_HYPE_WEI = "700000000000000000000"
    FWA_LP_RANGE_WIDTH_TICKS = "3600"
    PROJECTX_WHYPE = "0x5555555555555555555555555555555555555555"
}

$lines = [Collections.Generic.List[string]]::new()
$seen = @{}
foreach ($line in [IO.File]::ReadAllLines($resolvedPath)) {
    $match = [regex]::Match($line, '^([A-Za-z_][A-Za-z0-9_]*)=')
    if ($match.Success -and $publicValues.Contains($match.Groups[1].Value)) {
        $key = $match.Groups[1].Value
        if (-not $seen.ContainsKey($key)) {
            $lines.Add("$key=$($publicValues[$key])")
            $seen[$key] = $true
        }
    } else {
        $lines.Add($line)
    }
}

$missing = @($publicValues.Keys | Where-Object { -not $seen.ContainsKey($_) })
if ($missing.Count -gt 0) {
    $lines.Add("")
    $lines.Add("# Frozen public HWA mainnet configuration; synchronized without printing secrets.")
    foreach ($key in $missing) { $lines.Add("$key=$($publicValues[$key])") }
}

$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllLines($resolvedPath, $lines, $utf8NoBom)
Write-Host "Synchronized $($publicValues.Count) public HWA mainnet fields in $resolvedPath."
Write-Host "Private keys and provider credentials were preserved and not printed."
if ($FinalizeDeployedSafe) {
    Write-Host "The deployed 2-of-3 Safe was attested live and is now the owner and treasury recipient."
} else {
    Write-Host "Owner and treasury recipient fields remain zero until -FinalizeDeployedSafe passes."
}
