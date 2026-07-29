param(
    [string]$Path = ".env.mainnet.local",
    [Parameter(Mandatory = $true)][string[]]$Set
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedPath = if ([IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $projectRoot $Path }
if (-not (Test-Path -LiteralPath $resolvedPath)) { throw "Mainnet env file not found: $resolvedPath" }

$allowedAddressKeys = @(
    "FWA_SPLITTER_SNAPSHOT_NFT", "FWA_SPLITTER_ADDRESS", "FWA_ADDRESS", "FWA_VRF_SERVICE_ADDRESS",
    "FWA_DRAND_REGISTRY_ADDRESS", "FWA_DRAND_BN254_COORDINATOR_ADDRESS", "FWA_WHITELIST_ADDRESS",
    "FWA_TOKEN_ADDRESS", "FWA_REWARDS_ADDRESS", "FWA_PROJECTX_ADAPTER_ADDRESS",
    "FWA_PROJECTX_POOL_ADDRESS", "FWA_PROJECTX_LIQUIDITY_LOCKER_ADDRESS",
    "HWA_ECOSYSTEM_BENEFICIARY", "HWA_ECOSYSTEM_VESTING_ADDRESS"
)
$allowedBooleanKeys = @(
    "HWA_GENESIS_NFT_FINALIZATION_CONFIRMED", "FWA_SPLITTER_FREEZE_CONFIRMED",
    "FWA_SPLITTER_DEPLOYMENT_CONFIRMED", "PROJECTX_CORE_BINDING_CONFIRMED",
    "HYPEREVM_LOG_RPC_RUNTIME_ATTESTED", "MAINNET_ACTIVATION_CONFIRMED",
    "MAINNET_SOURCE_VERIFICATION_CONFIRMED", "PROJECTX_E2E_CONFIRMED", "INDEXER_DEPLOYMENT_CONFIRMED"
)
$allowedUintKeys = @(
    "FWA_SPLITTER_MAX_TOKEN_ID", "FWA_DRAND_DEPLOYMENT_BLOCK", "FWA_MAINNET_DEPLOYMENT_BLOCK", "HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE",
    "NEXT_PUBLIC_HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE"
)
$allowedStringKeys = @(
    "HYPEREVM_LOG_RPC_PROVIDER", "HYPEREVM_LOG_RPC_UPSTREAM_HOST",
    "HYPEREVM_LOG_RPC_UPSTREAM_FINGERPRINT_SHA256", "HYPEREVM_LOG_RPC_PUBLIC_PROBE_URL",
    "HYPEREVM_LOG_RPC_ALLOWED_ADDRESSES", "NEXT_PUBLIC_INDEXER_URL"
)
$allowed = @($allowedAddressKeys + $allowedBooleanKeys + $allowedUintKeys + $allowedStringKeys)
$updates = [ordered]@{}

foreach ($assignment in $Set) {
    $separator = $assignment.IndexOf("=")
    if ($separator -le 0) { throw "Assignments must use KEY=VALUE" }
    $key = $assignment.Substring(0, $separator)
    $value = $assignment.Substring($separator + 1)
    if ($key -notin $allowed) { throw "Deployment key is not allowlisted: $key" }
    if ($key -in $allowedAddressKeys -and $value -notmatch '^0x[0-9a-fA-F]{40}$') {
        throw "Invalid address for $key"
    }
    if ($key -in $allowedBooleanKeys -and $value -notin @("true", "false")) {
        throw "Invalid boolean for $key"
    }
    if ($key -in $allowedUintKeys) {
        $parsed = [System.Numerics.BigInteger]::Zero
        if (-not [System.Numerics.BigInteger]::TryParse($value, [ref]$parsed) -or $parsed -lt 0) {
            throw "Invalid unsigned integer for $key"
        }
    }
    if ($key -eq "HYPEREVM_LOG_RPC_PROVIDER" -and $value -notmatch '^[a-z0-9-]{1,32}$') { throw "Invalid provider" }
    if ($key -eq "HYPEREVM_LOG_RPC_UPSTREAM_HOST" -and $value -notmatch '^[a-z0-9.-]{1,253}$') { throw "Invalid host" }
    if ($key -eq "HYPEREVM_LOG_RPC_UPSTREAM_FINGERPRINT_SHA256" -and $value -notmatch '^[0-9a-f]{64}$') {
        throw "Invalid upstream fingerprint"
    }
    if ($key -in @("HYPEREVM_LOG_RPC_PUBLIC_PROBE_URL", "NEXT_PUBLIC_INDEXER_URL") -and $value -notmatch '^https://') {
        throw "Invalid HTTPS URL for $key"
    }
    if ($key -eq "HYPEREVM_LOG_RPC_ALLOWED_ADDRESSES" -and $value -notmatch '^0x[0-9a-fA-F]{40}(,0x[0-9a-fA-F]{40})*$') {
        throw "Invalid RPC address allowlist"
    }
    $updates[$key] = $value
}

$lines = [Collections.Generic.List[string]]::new()
$seen = @{}
foreach ($line in [IO.File]::ReadAllLines($resolvedPath)) {
    $match = [regex]::Match($line, '^([A-Za-z_][A-Za-z0-9_]*)=')
    if ($match.Success -and $updates.Contains($match.Groups[1].Value)) {
        $key = $match.Groups[1].Value
        if (-not $seen.ContainsKey($key)) {
            $lines.Add("$key=$($updates[$key])")
            $seen[$key] = $true
        }
    } else {
        $lines.Add($line)
    }
}
foreach ($key in $updates.Keys) {
    if (-not $seen.ContainsKey($key)) { $lines.Add("$key=$($updates[$key])") }
}

$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllLines($resolvedPath, $lines, $utf8NoBom)
Write-Host "Updated $($updates.Count) allowlisted public deployment fields without printing values or secrets."
