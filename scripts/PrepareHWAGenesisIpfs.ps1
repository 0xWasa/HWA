param(
    [string]$SourceRoot = "frontend/public/genesis/v3",
    [string]$OutputPath = "release/hwa-genesis-canonical.json",
    [string]$ImageCid = "",
    [string]$MetadataCid = "",
    [string]$FinalOutputRoot = "release/hwa-genesis-v3-final"
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd("\", "/")
$approvedAggregate = "96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648"
$approvedRenderer = "HWA-GEN-3.0.0"
$placeholderImageBaseUri = "ipfs://__HWA_GENESIS_V3_IMAGES_CID__/"

function Resolve-ProjectPath([string]$Path, [string]$Label) {
    $resolved = if ([System.IO.Path]::IsPathRooted($Path)) {
        [System.IO.Path]::GetFullPath($Path)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $projectRoot $Path))
    }
    $prefix = $projectRoot + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay inside the project root: $resolved"
    }
    return $resolved
}

function To-ProjectRelative([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $prefix = $projectRoot + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Cannot make an out-of-project path relative: $fullPath"
    }
    return $fullPath.Substring($prefix.Length).Replace("\", "/")
}

function Assert-CidV1([string]$Cid, [string]$Label) {
    if ($Cid -notmatch '^bafy[a-z2-7]{20,}$') {
        throw "$Label must be a lowercase base32 CIDv1 beginning with 'bafy'"
    }
}

$sourcePath = Resolve-ProjectPath $SourceRoot "SourceRoot"
$outputFile = Resolve-ProjectPath $OutputPath "OutputPath"
$generator = Join-Path $projectRoot "scripts/generate-hwa-genesis-v3.mjs"
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) { throw "Missing canonical v3 source: $sourcePath" }
if (-not (Test-Path -LiteralPath $generator -PathType Leaf)) { throw "Missing v3 generator: $generator" }

& node $generator --verify-only --output $sourcePath
if ($LASTEXITCODE -ne 0) { throw "Canonical v3 verification failed" }

$manifestPath = Join-Path $sourcePath "manifest.json"
$traitsPath = Join-Path $sourcePath "traits.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$traitsPayload = Get-Content -LiteralPath $traitsPath -Raw | ConvertFrom-Json
$traits = @($traitsPayload)
if ($manifest.rendererVersion -ne $approvedRenderer) { throw "Unexpected renderer: $($manifest.rendererVersion)" }
if ($manifest.supply -ne 333 -or @($manifest.files).Count -ne 333 -or $traits.Count -ne 333) {
    throw "Canonical v3 supply must be exactly 333"
}
if ($manifest.aggregateSha256 -ne $approvedAggregate) {
    throw "Canonical v3 aggregate changed after visual approval: $($manifest.aggregateSha256)"
}
if ($manifest.imageBaseUri -ne $placeholderImageBaseUri) {
    throw "Canonical source must retain the unpinned image-CID placeholder"
}

$imageFiles = @(Get-ChildItem -LiteralPath (Join-Path $sourcePath "images") -File -Filter "*.svg")
$metadataFiles = @(Get-ChildItem -LiteralPath (Join-Path $sourcePath "metadata") -File -Filter "*.json")
$uniqueImages = @($imageFiles | Get-FileHash -Algorithm SHA256 | Select-Object -ExpandProperty Hash | Sort-Object -Unique)
$uniqueGeometry = @($traits.geometryFingerprint | Sort-Object -Unique)
if ($imageFiles.Count -ne 333 -or $metadataFiles.Count -ne 333 -or $uniqueImages.Count -ne 333 -or $uniqueGeometry.Count -ne 333) {
    throw "Canonical v3 uniqueness or file-count invariant failed"
}

if ($MetadataCid -and -not $ImageCid) { throw "MetadataCid cannot be prepared without ImageCid" }
if ($ImageCid) { Assert-CidV1 $ImageCid "ImageCid" }
if ($MetadataCid) { Assert-CidV1 $MetadataCid "MetadataCid" }

$finalPath = $null
$contractMetadataPath = $null
$imageBaseUri = $placeholderImageBaseUri
$metadataBaseUri = $null
$metadataReadyForPin = $false

if ($ImageCid) {
    $finalPath = Resolve-ProjectPath $FinalOutputRoot "FinalOutputRoot"
    if (Test-Path -LiteralPath $finalPath) {
        if (-not (Get-Item -LiteralPath $finalPath).PSIsContainer) { throw "FinalOutputRoot is not a directory" }
        if (@(Get-ChildItem -LiteralPath $finalPath -Force).Count -ne 0) {
            throw "Refusing to overwrite non-empty final output: $finalPath"
        }
    }
    $imageBaseUri = "ipfs://$ImageCid/"
    & node $generator --output $finalPath --image-base-uri $imageBaseUri
    if ($LASTEXITCODE -ne 0) { throw "Final metadata generation failed" }

    # HWAGenesisNFT.tokenURI() concatenates baseURI with the unpadded decimal token ID and no
    # extension. The directory pinned for metadata must therefore contain files named 1..333.
    $contractMetadataPath = Join-Path $finalPath "contract-metadata"
    New-Item -ItemType Directory -Path $contractMetadataPath -Force | Out-Null
    for ($tokenId = 1; $tokenId -le 333; $tokenId++) {
        $sourceName = $tokenId.ToString().PadLeft(3, "0") + ".json"
        $sourceMetadata = Join-Path (Join-Path $finalPath "metadata") $sourceName
        $destinationMetadata = Join-Path $contractMetadataPath $tokenId.ToString()
        $payload = Get-Content -LiteralPath $sourceMetadata -Raw | ConvertFrom-Json
        if ($payload.image -ne ($imageBaseUri + $sourceName.Replace(".json", ".svg"))) {
            throw "Unexpected image URI in metadata $sourceName"
        }
        Copy-Item -LiteralPath $sourceMetadata -Destination $destinationMetadata
    }
    $contractFiles = @(Get-ChildItem -LiteralPath $contractMetadataPath -File)
    if ($contractFiles.Count -ne 333 -or -not (Test-Path -LiteralPath (Join-Path $contractMetadataPath "1")) `
        -or -not (Test-Path -LiteralPath (Join-Path $contractMetadataPath "333"))) {
        throw "Contract-compatible metadata staging failed"
    }
    $metadataReadyForPin = $true
}

if ($MetadataCid) { $metadataBaseUri = "ipfs://$MetadataCid/" }
$crownIds = @($traits | Where-Object { $_.sizeClass -eq "CROWN" } | Sort-Object tokenId | Select-Object -ExpandProperty tokenId)
$blockers = New-Object System.Collections.Generic.List[string]
if (-not $ImageCid) { $blockers.Add("PIN_AND_VERIFY_IMAGE_DIRECTORY") }
if (-not $MetadataCid) { $blockers.Add("PIN_AND_VERIFY_CONTRACT_METADATA_DIRECTORY") }
$blockers.Add("ATTEST_FINAL_BASE_URI_BEFORE_GENESIS_DEPLOYMENT")

$report = [ordered]@{
    schemaVersion = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    canonical = $true
    visualApproval = [ordered]@{
        status = "approved"
        collectionVersion = "v3"
        direction = "PRESSURE FIELD"
        renderer = $approvedRenderer
        aggregateSha256 = $approvedAggregate
        approvalDate = "2026-07-27"
    }
    supply = 333
    equalEconomicUnits = $true
    classCounts = $manifest.exactCounts.classes
    classMasterIds = $manifest.classMasterIds
    crownIds = $crownIds
    source = [ordered]@{
        root = To-ProjectRelative $sourcePath
        images = To-ProjectRelative (Join-Path $sourcePath "images")
        metadataTemplates = To-ProjectRelative (Join-Path $sourcePath "metadata")
        manifest = To-ProjectRelative $manifestPath
        traits = To-ProjectRelative $traitsPath
        generator = "scripts/generate-hwa-genesis-v3.mjs"
        imageCount = $imageFiles.Count
        metadataTemplateCount = $metadataFiles.Count
        uniqueImageHashes = $uniqueImages.Count
        uniqueGeometryFingerprints = $uniqueGeometry.Count
    }
    tokenUriCompatibility = [ordered]@{
        contract = "HWAGenesisNFT"
        contractShape = "baseURI + unpadded decimal tokenId"
        pinnedMetadataFileNames = "1..333 with no extension"
    }
    ipfs = [ordered]@{
        imageCid = if ($ImageCid) { $ImageCid } else { $null }
        imageBaseUri = $imageBaseUri
        imageSourceDirectory = To-ProjectRelative (Join-Path $sourcePath "images")
        metadataCid = if ($MetadataCid) { $MetadataCid } else { $null }
        metadataBaseUri = $metadataBaseUri
        contractMetadataSourceDirectory = if ($contractMetadataPath) { To-ProjectRelative $contractMetadataPath } else { $null }
        metadataReadyForPin = $metadataReadyForPin
        requiredReplication = "two independent pinning providers and two independent gateway reads"
    }
    deploymentAllowed = $false
    blockers = @($blockers)
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputFile) | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outputFile, ($report | ConvertTo-Json -Depth 8), $utf8NoBom)
Write-Host "Wrote canonical HWA Genesis/IPFS preparation report to $outputFile"
Write-Host "No pinning, deployment or on-chain action was performed."
