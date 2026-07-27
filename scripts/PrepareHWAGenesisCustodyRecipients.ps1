param(
    [string]$Safe = "0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C",
    [int]$Supply = 333,
    [string]$OutputPath = "release/hwa-genesis-custody-recipients.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$cast = Join-Path $projectRoot ".tools\foundry\cast.exe"
if (-not (Test-Path -LiteralPath $cast)) { throw "Foundry cast not found at $cast" }
if ($Safe -notmatch '^0x[0-9a-fA-F]{40}$' -or $Safe -eq "0x0000000000000000000000000000000000000000") {
    throw "Invalid Safe address"
}
$checksum = (& $cast to-check-sum-address $Safe 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $checksum -cne $Safe) { throw "Safe address is not checksummed exactly" }
if ($Supply -ne 333) { throw "The frozen HWA Genesis supply must be exactly 333" }

$batches = New-Object System.Collections.Generic.List[object]
$remaining = $Supply
$firstTokenId = 1
while ($remaining -gt 0) {
    $count = [Math]::Min(100, $remaining)
    $recipients = @($Safe) * $count
    $batches.Add([ordered]@{
        firstTokenId = $firstTokenId
        lastTokenId = $firstTokenId + $count - 1
        count = $count
        recipients = $recipients
    })
    $firstTokenId += $count
    $remaining -= $count
}

$mintBatches = $batches.ToArray()
$report = [ordered]@{
    schemaVersion = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    status = "prepared-pending-safe-deployment-and-final-base-uri"
    chainId = 999
    collection = [ordered]@{
        name = "HWA Genesis"
        symbol = "HWAG"
        supply = $Supply
        initialCustodian = $Safe
    }
    mintBatches = $mintBatches
    freezePolicy = [ordered]@{
        freezeAfterAllMints = $true
        requireFinalMetadataReview = $true
        requireCurrentSupply = $Supply
        requireHighestMintedTokenId = $Supply
        freezeInSameSafeBatchAsMints = $false
    }
    distributionPolicy = [ordered]@{
        initialCustodyIsNotFinalAllocation = $true
        tokensRemainTransferableAfterSnapshotFreeze = $true
        splitterRightsFollowCurrentTokenOwner = $true
        safeMustNotClaimNftAllocationBeforeReviewedDistribution = $true
    }
    broadcastPerformed = $false
}

$resolvedOutput = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $projectRoot $OutputPath }
$directory = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($resolvedOutput, ($report | ConvertTo-Json -Depth 10), $utf8NoBom)
Write-Host "Prepared four HWA Genesis custody batches (100/100/100/33) for $Safe."
Write-Host "No transaction was broadcast and snapshot freeze remains a separate reviewed action."
Write-Host "Artifact: $resolvedOutput"
