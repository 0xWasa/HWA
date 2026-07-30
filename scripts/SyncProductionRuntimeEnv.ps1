param(
    [Parameter(Mandatory = $true)] [string]$SourcePath,
    [Parameter(Mandatory = $true)] [string]$TargetPath,
    [Parameter(Mandatory = $true)] [string]$PublicIndexerUrl,
    [Parameter(Mandatory = $true)] [string]$AllowedAddresses
)

$ErrorActionPreference = "Stop"
if ($PublicIndexerUrl -notmatch '^https://') { throw "PublicIndexerUrl must use HTTPS" }
if ($AllowedAddresses -notmatch '^0x[0-9a-fA-F]{40}(,0x[0-9a-fA-F]{40})*$') {
    throw "AllowedAddresses must be a comma-separated EVM address list"
}

$source = @{}
foreach ($line in [IO.File]::ReadAllLines((Resolve-Path -LiteralPath $SourcePath))) {
    $match = [regex]::Match($line, '^([A-Z_][A-Z0-9_]*)=(.*)$')
    if ($match.Success) { $source[$match.Groups[1].Value] = $match.Groups[2].Value }
}
$source["NEXT_PUBLIC_INDEXER_URL"] = $PublicIndexerUrl
$source["HYPEREVM_LOG_RPC_ALLOWED_ADDRESSES"] = $AllowedAddresses

$keys = @(
    "NEXT_PUBLIC_HYPEREVM_RPC_URL", "NEXT_PUBLIC_HYPEREVM_LOG_RPC_URL",
    "NEXT_PUBLIC_HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE", "NEXT_PUBLIC_INDEXER_URL",
    "HYPEREVM_LOG_RPC_PROVIDER", "HYPEREVM_LOG_RPC_UPSTREAM_URL", "HYPEREVM_LOG_RPC_API_KEY",
    "HYPEREVM_LOG_RPC_API_KEY_HEADER", "HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE",
    "HYPEREVM_LOG_RPC_ALLOWED_ADDRESSES", "HYPEREVM_LOG_RPC_ATTESTATION_PATH"
)

$target = (Resolve-Path -LiteralPath $TargetPath).Path
$output = [Collections.Generic.List[string]]::new()
$seen = @{}
foreach ($line in [IO.File]::ReadAllLines($target)) {
    $match = [regex]::Match($line, '^([A-Z_][A-Z0-9_]*)=')
    if ($match.Success -and $match.Groups[1].Value -in $keys) {
        $key = $match.Groups[1].Value
        if (-not $seen.ContainsKey($key)) {
            if ($source.ContainsKey($key)) { $output.Add("$key=$($source[$key])") } else { $output.Add($line) }
            $seen[$key] = $true
        }
    } else {
        $output.Add($line)
    }
}
foreach ($key in $keys) {
    if (-not $seen.ContainsKey($key) -and $source.ContainsKey($key)) { $output.Add("$key=$($source[$key])") }
}

[IO.File]::WriteAllLines($target, $output, (New-Object Text.UTF8Encoding($false)))
Write-Host "Synced the allowlisted production runtime settings without printing values."
