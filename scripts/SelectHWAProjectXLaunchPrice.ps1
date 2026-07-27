param(
    [string]$Deployer = "0x24398fc31899E2384E4E070fcdBF8Bb6D916FcD9",
    [string]$RpcUrl = "https://rpc.hyperliquid.xyz/evm",
    [string]$WorksheetPath = "release/hwa-launch-economics-preparation.json",
    [string]$OutputPath = "release/hwa-projectx-launch-price-selection.json",
    [string]$EnvPath = ".env.mainnet.local",
    [switch]$SyncEnv
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd("\", "/")
$cast = Join-Path $projectRoot ".tools\foundry\cast.exe"
$whype = "0x5555555555555555555555555555555555555555"

function Resolve-ProjectPath([string]$Path, [string]$Label) {
    $resolved = if ([IO.Path]::IsPathRooted($Path)) { [IO.Path]::GetFullPath($Path) } `
        else { [IO.Path]::GetFullPath((Join-Path $projectRoot $Path)) }
    $prefix = $projectRoot + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay inside the project root: $resolved"
    }
    return $resolved
}

function Invoke-Cast([string[]]$Arguments) {
    $output = (& $cast @Arguments 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "cast failed: $output" }
    return $output
}

function Get-ComputedAddress([string]$Creator, [uint64]$Nonce) {
    $output = Invoke-Cast @("compute-address", $Creator, "--nonce", "$Nonce")
    $match = [regex]::Match($output, '0x[0-9a-fA-F]{40}')
    if (-not $match.Success) { throw "Could not parse computed address: $output" }
    return $match.Value
}

function Set-EnvValues([string]$Path, [Collections.Specialized.OrderedDictionary]$Values) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Mainnet env file not found: $Path" }
    $lines = [Collections.Generic.List[string]]::new()
    $seen = @{}
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $match = [regex]::Match($line, '^([A-Za-z_][A-Za-z0-9_]*)=')
        if ($match.Success -and $Values.Contains($match.Groups[1].Value)) {
            $key = $match.Groups[1].Value
            if (-not $seen.ContainsKey($key)) {
                $lines.Add("$key=$($Values[$key])")
                $seen[$key] = $true
            }
        } else { $lines.Add($line) }
    }
    $missing = @($Values.Keys | Where-Object { -not $seen.ContainsKey($_) })
    if ($missing.Count -gt 0) {
        $lines.Add("")
        $lines.Add("# Non-secret Project X launch price selected from the live deployer nonce.")
        foreach ($key in $missing) { $lines.Add("$key=$($Values[$key])") }
    }
    [IO.File]::WriteAllLines($Path, $lines, (New-Object Text.UTF8Encoding($false)))
}

if (-not (Test-Path -LiteralPath $cast -PathType Leaf)) { throw "Foundry cast not found at $cast" }
if ($Deployer -notmatch '^0x[0-9a-fA-F]{40}$') { throw "Invalid deployer address" }
$worksheetFile = Resolve-ProjectPath $WorksheetPath "WorksheetPath"
$outputFile = Resolve-ProjectPath $OutputPath "OutputPath"
$envFile = Resolve-ProjectPath $EnvPath "EnvPath"
$worksheet = Get-Content -LiteralPath $worksheetFile -Raw | ConvertFrom-Json
if ($worksheet.chainId -ne 999 -or $worksheet.economics.targetFdvHype -ne "640" `
    -or $worksheet.economics.minimumFdvHype -ne "600" -or $worksheet.economics.maximumFdvHype -ne "700") {
    throw "Launch worksheet no longer matches the approved 640 HYPE target and 600-700 band"
}

$chainId = Invoke-Cast @("chain-id", "--rpc-url", $RpcUrl)
if ($chainId -ne "999") { throw "Expected HyperEVM mainnet chain 999, got $chainId" }
$nonceText = Invoke-Cast @("nonce", $Deployer, "--rpc-url", $RpcUrl)
$nonce = [uint64]::Parse($nonceText)
$factory = Get-ComputedAddress $Deployer $nonce
# FWATokenHyperEVM is the first CREATE performed by FWATokenHyperEVMFactory's constructor.
$token = Get-ComputedAddress $factory 1
$factoryCode = Invoke-Cast @("code", $factory, "--rpc-url", $RpcUrl)
$tokenCode = Invoke-Cast @("code", $token, "--rpc-url", $RpcUrl)
if ($factoryCode -ne "0x" -or $tokenCode -ne "0x") { throw "Predicted launch address already contains code" }

$hwaIsToken0 = [string]::Compare($token, $whype, [StringComparison]::OrdinalIgnoreCase) -lt 0
$candidate = if ($hwaIsToken0) { $worksheet.priceCandidates.hwaIsToken0 } else { $worksheet.priceCandidates.hwaIsToken1 }
$ordering = if ($hwaIsToken0) { "HWA_TOKEN0" } else { "HWA_TOKEN1" }
$report = [ordered]@{
    schemaVersion = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    status = if ($SyncEnv) { "nonce-bound-and-synced" } else { "preview-only" }
    chainId = 999
    deployer = $Deployer
    deployerNonce = $nonce
    predictedLaunchFactory = $factory
    predictedHwaToken = $token
    whype = $whype
    ordering = $ordering
    targetFdvHype = "640"
    minimumFdvHype = "600"
    maximumFdvHype = "700"
    sqrtPriceX96 = $candidate.sqrtPriceX96
    derivedFdvHypeWei = $candidate.derivedFdvHypeWei
    currentTick = $candidate.currentTick
    tickLower = $candidate.tickLower
    tickUpper = $candidate.tickUpper
    validOnlyWhileDeployerNonceEquals = $nonce
    broadcastPerformed = $false
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputFile) | Out-Null
[IO.File]::WriteAllText($outputFile, ($report | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))

if ($SyncEnv) {
    $values = [ordered]@{
        FWA_CHAIN_ID = "999"
        FWA_INITIAL_SQRT_PRICE_X96 = [string]$candidate.sqrtPriceX96
        FWA_INITIAL_SQRT_PRICE_X96_ECHO = [string]$candidate.sqrtPriceX96
        MAINNET_FWA_MIN_INITIAL_FDV_HYPE_WEI = [string]$worksheet.economics.minimumFdvHypeWei
        MAINNET_FWA_MAX_INITIAL_FDV_HYPE_WEI = [string]$worksheet.economics.maximumFdvHypeWei
        FWA_LP_RANGE_WIDTH_TICKS = "3600"
        PROJECTX_MARKET_PRICE_CONFIRMED = "true"
        PROJECTX_LP_LOCK_CONFIRMED = "true"
    }
    Set-EnvValues $envFile $values
    Write-Host "Synchronized the nonce-bound public price fields without printing or modifying secrets."
}

Write-Host "Selected $ordering for deployer nonce $nonce at the approved 640 HYPE target."
Write-Host "Predicted factory: $factory"
Write-Host "Predicted HWA: $token"
Write-Host "No transaction was broadcast. Re-run immediately before DeployProjectXToken; any nonce change invalidates this selection."
