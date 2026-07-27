param(
    [string]$SourceRoot = "frontend/public/genesis/v3",
    [string]$OutputRoot = "release/hwa-genesis-v3-hosting",
    [string]$PublicOrigin = "",
    [string]$ReportPath = "release/hwa-genesis-canonical.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd("\", "/")
$approvedAggregate = "96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648"
$approvedRenderer = "HWA-GEN-3.0.0"
$placeholderImageBaseUri = "ipfs://__HWA_GENESIS_V3_IMAGES_CID__/"
$templateOrigin = "https://assets.example.invalid"
$isTemplate = [string]::IsNullOrWhiteSpace($PublicOrigin)
if ($isTemplate) { $PublicOrigin = $templateOrigin }

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

function Assert-PublicOrigin([string]$Value, [bool]$Template) {
    $uri = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri)) { throw "PublicOrigin must be an absolute URI" }
    if ($uri.Scheme -ne "https" -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
        throw "PublicOrigin must be a credential-free HTTPS origin"
    }
    if ($uri.AbsolutePath -ne "/") { throw "PublicOrigin must not contain a path; the versioned path is generated" }
    if (-not $Template -and ($uri.Host -eq "example.invalid" -or $uri.Host.EndsWith(".example.invalid") `
        -or $uri.IsLoopback -or $uri.Host -eq "localhost")) {
        throw "A real public HTTPS host is required outside template mode"
    }
    return $uri.GetLeftPart([UriPartial]::Authority).TrimEnd("/")
}

$origin = Assert-PublicOrigin $PublicOrigin $isTemplate
$versionPath = "hwa-genesis/v3/$approvedAggregate"
$publicVersionRoot = "$origin/$versionPath"
$imageBaseUri = "$publicVersionRoot/images/"
$metadataBaseUri = "$publicVersionRoot/metadata/"

$sourcePath = Resolve-ProjectPath $SourceRoot "SourceRoot"
$outputPath = Resolve-ProjectPath $OutputRoot "OutputRoot"
$reportFile = Resolve-ProjectPath $ReportPath "ReportPath"
$generator = Join-Path $projectRoot "scripts/generate-hwa-genesis-v3.mjs"
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) { throw "Missing canonical v3 source: $sourcePath" }
if (-not (Test-Path -LiteralPath $generator -PathType Leaf)) { throw "Missing v3 generator: $generator" }
if (Test-Path -LiteralPath $outputPath) {
    if (-not (Get-Item -LiteralPath $outputPath).PSIsContainer) { throw "OutputRoot is not a directory" }
    if (@(Get-ChildItem -LiteralPath $outputPath -Force).Count -ne 0) {
        throw "Refusing to overwrite non-empty hosting package: $outputPath"
    }
}

& node $generator --verify-only --output $sourcePath
if ($LASTEXITCODE -ne 0) { throw "Canonical v3 verification failed" }
$sourceManifest = Get-Content -LiteralPath (Join-Path $sourcePath "manifest.json") -Raw | ConvertFrom-Json
if ($sourceManifest.rendererVersion -ne $approvedRenderer -or $sourceManifest.supply -ne 333 `
    -or $sourceManifest.aggregateSha256 -ne $approvedAggregate `
    -or $sourceManifest.imageBaseUri -ne $placeholderImageBaseUri) {
    throw "Canonical v3 source no longer matches the approved renderer, supply, aggregate or placeholder"
}

$generatedPath = Join-Path $outputPath "generated"
$publicRoot = Join-Path $outputPath "public"
$publicVersionPath = Join-Path $publicRoot ($versionPath.Replace("/", [System.IO.Path]::DirectorySeparatorChar))
$publicImages = Join-Path $publicVersionPath "images"
$publicMetadata = Join-Path $publicVersionPath "metadata"
New-Item -ItemType Directory -Force -Path $generatedPath, $publicImages, $publicMetadata | Out-Null

& node $generator --output $generatedPath --image-base-uri $imageBaseUri
if ($LASTEXITCODE -ne 0) { throw "HTTPS metadata generation failed" }
$hostedManifest = Get-Content -LiteralPath (Join-Path $generatedPath "manifest.json") -Raw | ConvertFrom-Json
if ($hostedManifest.rendererVersion -ne $approvedRenderer -or $hostedManifest.supply -ne 333) {
    throw "Generated hosting manifest is invalid"
}

Get-ChildItem -LiteralPath (Join-Path $generatedPath "images") -File -Filter "*.svg" | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $publicImages
}
for ($tokenId = 1; $tokenId -le 333; $tokenId++) {
    $padded = $tokenId.ToString().PadLeft(3, "0")
    $sourceMetadata = Join-Path $generatedPath "metadata\$padded.json"
    $destinationMetadata = Join-Path $publicMetadata $tokenId.ToString()
    $payload = Get-Content -LiteralPath $sourceMetadata -Raw | ConvertFrom-Json
    if ($payload.properties.token_id -ne $tokenId -or $payload.image -ne "$imageBaseUri$padded.svg") {
        throw "Unexpected hosted metadata for token $tokenId"
    }
    Copy-Item -LiteralPath $sourceMetadata -Destination $destinationMetadata
}

$imageFiles = @(Get-ChildItem -LiteralPath $publicImages -File -Filter "*.svg")
$metadataFiles = @(Get-ChildItem -LiteralPath $publicMetadata -File)
if ($imageFiles.Count -ne 333 -or $metadataFiles.Count -ne 333 `
    -or -not (Test-Path -LiteralPath (Join-Path $publicMetadata "1")) `
    -or -not (Test-Path -LiteralPath (Join-Path $publicMetadata "333"))) {
    throw "The VPS package must contain 333 SVG images and extensionless metadata files 1..333"
}

$fileRecords = New-Object System.Collections.Generic.List[object]
foreach ($entry in @($hostedManifest.files | Sort-Object tokenId)) {
    $tokenId = [int]$entry.tokenId
    $padded = $tokenId.ToString().PadLeft(3, "0")
    $imageFile = Join-Path $publicImages "$padded.svg"
    $metadataFile = Join-Path $publicMetadata $tokenId.ToString()
    $imageSha = (Get-FileHash -LiteralPath $imageFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $metadataSha = (Get-FileHash -LiteralPath $metadataFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($imageSha -ne $entry.imageSha256 -or $metadataSha -ne $entry.metadataSha256) {
        throw "Hosted file hash mismatch for token $tokenId"
    }
    $fileRecords.Add([ordered]@{
        tokenId = $tokenId
        imageUrl = "$imageBaseUri$padded.svg"
        imageSha256 = $imageSha
        metadataUrl = "$metadataBaseUri$tokenId"
        metadataSha256 = $metadataSha
        geometryFingerprintSha256 = $entry.geometryFingerprint
    })
}

$deploymentManifest = [ordered]@{
    schemaVersion = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    collection = "Hyper World Assets Genesis"
    renderer = $approvedRenderer
    supply = 333
    sourceArtAggregateSha256 = $approvedAggregate
    hostedMetadataAggregateSha256 = $hostedManifest.aggregateSha256
    template = $isTemplate
    publicOrigin = $origin
    versionPath = $versionPath
    imageBaseUri = $imageBaseUri
    tokenBaseUri = $metadataBaseUri
    contractTokenUriShape = "tokenBaseUri + unpadded decimal tokenId"
    files = $fileRecords.ToArray()
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$deploymentManifestPath = Join-Path $publicVersionPath "deployment-manifest.json"
[System.IO.File]::WriteAllText($deploymentManifestPath, ($deploymentManifest | ConvertTo-Json -Depth 7), $utf8NoBom)

$checksumLines = Get-ChildItem -LiteralPath $publicVersionPath -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($publicVersionPath.Length + 1).Replace("\", "/")
    $sha = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$sha  $relative"
}
[System.IO.File]::WriteAllLines((Join-Path $publicVersionPath "checksums.sha256"), $checksumLines, $utf8NoBom)

$blockers = New-Object System.Collections.Generic.List[string]
if ($isTemplate) { $blockers.Add("SET_REAL_GENESIS_HTTPS_ORIGIN") }
$blockers.Add("UPLOAD_EXACT_PACKAGE_TO_IMMUTABLE_VERSION_PATH")
$blockers.Add("VERIFY_ALL_333_REMOTE_IMAGES_AND_METADATA")
$blockers.Add("ATTEST_FINAL_HTTPS_BASE_URI_BEFORE_GENESIS_DEPLOYMENT")
$report = [ordered]@{
    schemaVersion = 2
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    canonical = $true
    visualApproval = [ordered]@{
        status = "approved"
        collectionVersion = "v3"
        direction = "PRESSURE FIELD"
        renderer = $approvedRenderer
        sourceArtAggregateSha256 = $approvedAggregate
        approvalDate = "2026-07-27"
    }
    supply = 333
    equalEconomicUnits = $true
    hosting = [ordered]@{
        mode = "versioned HTTPS VPS"
        template = $isTemplate
        publicOrigin = $origin
        versionPath = $versionPath
        imageBaseUri = $imageBaseUri
        tokenBaseUri = $metadataBaseUri
        packageRoot = To-ProjectRelative $outputPath
        publicDirectory = To-ProjectRelative $publicRoot
        deploymentManifest = To-ProjectRelative $deploymentManifestPath
        hostedMetadataAggregateSha256 = $hostedManifest.aggregateSha256
        requiredCacheControl = "public, max-age=31536000, immutable"
        requiredReplication = "primary VPS plus two independent backups; hash-verified restore drill"
    }
    tokenUriCompatibility = [ordered]@{
        contract = "HWAGenesisNFT"
        contractShape = "baseURI + unpadded decimal tokenId"
        metadataFileNames = "1..333 with no extension"
    }
    deploymentAllowed = $false
    blockers = @($blockers)
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportFile) | Out-Null
[System.IO.File]::WriteAllText($reportFile, ($report | ConvertTo-Json -Depth 8), $utf8NoBom)

Write-Host "Prepared HWA Genesis v3 VPS package at $outputPath"
Write-Host "Contract base URI candidate: $metadataBaseUri"
if ($isTemplate) { Write-Host "TEMPLATE ONLY: rerun with -PublicOrigin https://assets.your-domain.tld before upload." -ForegroundColor Yellow }
Write-Host "No upload, deployment, pinning or on-chain action was performed."
