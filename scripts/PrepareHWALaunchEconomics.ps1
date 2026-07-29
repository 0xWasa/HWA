param(
    [decimal]$TargetFdvHype = 640,
    [decimal]$MinimumFdvHype = 600,
    [decimal]$MaximumFdvHype = 700,
    [decimal]$OperationalHypeBudget = 20,
    [string]$OutputPath = "release/hwa-launch-economics-preparation.json"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Numerics
if ($TargetFdvHype -le 0 -or $MinimumFdvHype -le 0 -or $MaximumFdvHype -le 0) {
    throw "FDV values must be positive"
}
if ($MinimumFdvHype -gt $TargetFdvHype -or $TargetFdvHype -gt $MaximumFdvHype) {
    throw "Target FDV must lie inside the signed min/max band"
}
if ($OperationalHypeBudget -le 0 -or $OperationalHypeBudget -gt 20) {
    throw "Operational HYPE budget must be in (0, 20]"
}

function Convert-HypeToWei([decimal]$Value) {
    $scaled = $Value * [decimal]1000000000000000000
    if ([decimal]::Truncate($scaled) -ne $scaled) { throw "HYPE value has more than 18 decimals" }
    return [System.Numerics.BigInteger]::Parse($scaled.ToString("0", [Globalization.CultureInfo]::InvariantCulture))
}

function Get-BitLength([System.Numerics.BigInteger]$Value) {
    if ($Value -le 0) { return 0 }
    $hex = $Value.ToString("X")
    $first = [Convert]::ToInt32($hex.Substring(0, 1), 16)
    $leadingBits = if ($first -ge 8) { 4 } elseif ($first -ge 4) { 3 } elseif ($first -ge 2) { 2 } else { 1 }
    return (($hex.Length - 1) * 4) + $leadingBits
}

function Get-IntegerSqrt([System.Numerics.BigInteger]$Value) {
    if ($Value -lt 0) { throw "Cannot take square root of a negative integer" }
    if ($Value -lt 2) { return $Value }
    $x = [System.Numerics.BigInteger]::One -shl [int](([int](Get-BitLength $Value) + 1) / 2)
    while ($true) {
        $next = ($x + ($Value / $x)) / 2
        if ($next -ge $x) { return $x }
        $x = $next
    }
}

function Get-FloorTick([double]$Ratio) {
    return [int][Math]::Floor([Math]::Log($Ratio) / [Math]::Log(1.0001))
}

function Get-FloorToSpacing([int]$Tick, [int]$Spacing) {
    $remainder = $Tick % $Spacing
    $floor = $Tick - $remainder
    if ($remainder -lt 0) { $floor -= $Spacing }
    return $floor
}

$q96 = [System.Numerics.BigInteger]::One -shl 96
$q192 = [System.Numerics.BigInteger]::One -shl 192
$totalSupplyWei = [System.Numerics.BigInteger]::Parse("1000000000000000000000000000")
$lpSupplyWei = [System.Numerics.BigInteger]::Parse("800000000000000000000000000")
$targetFdvWei = Convert-HypeToWei $TargetFdvHype
$minimumFdvWei = Convert-HypeToWei $MinimumFdvHype
$maximumFdvWei = Convert-HypeToWei $MaximumFdvHype
$operationalBudgetWei = Convert-HypeToWei $OperationalHypeBudget

# Uniswap V3 stores sqrt(token1/token0) in Q96. Both HWA and wHYPE have 18 decimals.
$sqrtWhenHwaToken0 = Get-IntegerSqrt (($targetFdvWei * $q192) / $totalSupplyWei)
$sqrtWhenHwaToken1 = Get-IntegerSqrt (($totalSupplyWei * $q192) / $targetFdvWei)
$priceX96WhenHwaToken0 = ($sqrtWhenHwaToken0 * $sqrtWhenHwaToken0) / $q96
$priceX96WhenHwaToken1 = ($sqrtWhenHwaToken1 * $sqrtWhenHwaToken1) / $q96
$derivedFdvWhenHwaToken0 = ($totalSupplyWei * $priceX96WhenHwaToken0) / $q96
$derivedFdvWhenHwaToken1 = ($totalSupplyWei * $q96) / $priceX96WhenHwaToken1
if (
    $derivedFdvWhenHwaToken0 -lt $minimumFdvWei -or $derivedFdvWhenHwaToken0 -gt $maximumFdvWei -or
    $derivedFdvWhenHwaToken1 -lt $minimumFdvWei -or $derivedFdvWhenHwaToken1 -gt $maximumFdvWei
) { throw "Calculated price falls outside the signed FDV band" }

$ratio = [double]$TargetFdvHype / 1000000000.0
$tickHwaToken0 = Get-FloorTick $ratio
$tickHwaToken1 = Get-FloorTick (1.0 / $ratio)
$spacing = 200
$rangeWidth = 3600
$floor0 = Get-FloorToSpacing $tickHwaToken0 $spacing
$floor1 = Get-FloorToSpacing $tickHwaToken1 $spacing
$lower0 = $floor0 + $spacing
$upper0 = $lower0 + $rangeWidth
$upper1 = $floor1
$lower1 = $upper1 - $rangeWidth

$report = [ordered]@{
    schemaVersion = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    status = "recommended-pending-owner-confirmation"
    chainId = 999
    token = [ordered]@{
        name = "Hyper World Assets"
        symbol = "HWA"
        totalSupplyWei = "$totalSupplyWei"
        oneSidedLpSupplyWei = "$lpSupplyWei"
    }
    economics = [ordered]@{
        targetFdvHype = "$TargetFdvHype"
        targetFdvHypeWei = "$targetFdvWei"
        minimumFdvHype = "$MinimumFdvHype"
        minimumFdvHypeWei = "$minimumFdvWei"
        maximumFdvHype = "$MaximumFdvHype"
        maximumFdvHypeWei = "$maximumFdvWei"
        operationalHypeBudget = "$OperationalHypeBudget"
        operationalHypeBudgetWei = "$operationalBudgetWei"
        hypeSeededIntoLp = "0"
        explanation = "Project X launch LP is one-sided in HWA; the 20 HYPE cap funds deployment, drand and canary operations, not LP principal."
    }
    priceCandidates = [ordered]@{
        hwaIsToken0 = [ordered]@{
            condition = "predicted HWA address is lower than wHYPE"
            sqrtPriceX96 = "$sqrtWhenHwaToken0"
            derivedFdvHypeWei = "$derivedFdvWhenHwaToken0"
            currentTick = $tickHwaToken0
            tickLower = $lower0
            tickUpper = $upper0
        }
        hwaIsToken1 = [ordered]@{
            condition = "predicted HWA address is higher than wHYPE"
            sqrtPriceX96 = "$sqrtWhenHwaToken1"
            derivedFdvHypeWei = "$derivedFdvWhenHwaToken1"
            currentTick = $tickHwaToken1
            tickLower = $lower1
            tickUpper = $upper1
        }
    }
    selectionRule = "Predict the launch factory and HWA CREATE addresses from the funded deployer nonce, select exactly one candidate, then reproduce the FDV independently in the Foundry simulation before broadcast."
    rationale = "Rounded native-asset purchasing-power parity with the forensic FWA launch (~25 ETH FDV) at the 27 July 2026 ETH/HYPE reference ratio; final approval remains explicit because the pool price is irreversible."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutput = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $projectRoot $OutputPath }
$directory = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
Write-Host "Prepared HWA launch worksheet: target FDV $TargetFdvHype HYPE, signed band $MinimumFdvHype-$MaximumFdvHype HYPE."
Write-Host "No HYPE is seeded into the one-sided LP and no transaction was broadcast."
Write-Host "Artifact: $resolvedOutput"
