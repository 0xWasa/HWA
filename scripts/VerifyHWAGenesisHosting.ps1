param(
    [Parameter(Mandatory = $true)][string]$PackageRoot,
    [switch]$Remote,
    [string]$AttestationPath = "release/hwa-genesis-hosting-attestation.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd("\", "/")
$approvedAggregate = "96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648"

function Resolve-ProjectPath([string]$Path, [string]$Label) {
    $resolved = if ([System.IO.Path]::IsPathRooted($Path)) { [System.IO.Path]::GetFullPath($Path) } `
        else { [System.IO.Path]::GetFullPath((Join-Path $projectRoot $Path)) }
    $prefix = $projectRoot + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay inside the project root: $resolved"
    }
    return $resolved
}

function Get-Sha256Hex([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant() }
    finally { $sha.Dispose() }
}

$packagePath = Resolve-ProjectPath $PackageRoot "PackageRoot"
$manifestFiles = @(Get-ChildItem -LiteralPath $packagePath -File -Filter "deployment-manifest.json" -Recurse)
if ($manifestFiles.Count -ne 1) { throw "PackageRoot must contain exactly one deployment-manifest.json" }
$manifestPath = $manifestFiles[0].FullName
$versionPath = Split-Path -Parent $manifestPath
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.template -and $Remote) { throw "Template hosting packages can never receive a production attestation" }
if ($manifest.sourceArtAggregateSha256 -ne $approvedAggregate -or $manifest.supply -ne 333 `
    -or @($manifest.files).Count -ne 333) { throw "Hosting manifest does not match the approved Genesis v3 collection" }

$localImages = Join-Path $versionPath "images"
$localMetadata = Join-Path $versionPath "metadata"
foreach ($entry in @($manifest.files | Sort-Object tokenId)) {
    $tokenId = [int]$entry.tokenId
    $padded = $tokenId.ToString().PadLeft(3, "0")
    $imagePath = Join-Path $localImages "$padded.svg"
    $metadataPath = Join-Path $localMetadata $tokenId.ToString()
    if (-not (Test-Path -LiteralPath $imagePath -PathType Leaf) `
        -or -not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw "Missing local token $tokenId files" }
    $imageSha = (Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $metadataSha = (Get-FileHash -LiteralPath $metadataPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    if ($imageSha -ne $entry.imageSha256 -or $metadataSha -ne $entry.metadataSha256 `
        -or $metadata.image -ne $entry.imageUrl -or $metadata.properties.token_id -ne $tokenId) {
        throw "Local package verification failed for token $tokenId"
    }
}

$remoteVerified = $false
$remoteChecks = 0
if ($Remote) {
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(20)
    try {
        foreach ($entry in @($manifest.files | Sort-Object tokenId)) {
            foreach ($resource in @(
                @{ Url = $entry.imageUrl; Hash = $entry.imageSha256; Mime = "image/svg+xml" },
                @{ Url = $entry.metadataUrl; Hash = $entry.metadataSha256; Mime = "application/json" }
            )) {
                $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, [string]$resource.Url)
                $response = $client.SendAsync($request).GetAwaiter().GetResult()
                try {
                    if ([int]$response.StatusCode -ne 200) { throw "Remote GET returned $([int]$response.StatusCode): $($resource.Url)" }
                    $mime = $response.Content.Headers.ContentType.MediaType
                    if ($mime -ne $resource.Mime) { throw "Unexpected Content-Type '$mime': $($resource.Url)" }
                    $cache = ($response.Headers.CacheControl | Out-String).Trim()
                    if ($cache -notmatch 'max-age=31536000' -or $cache -notmatch 'immutable') {
                        throw "Missing immutable one-year Cache-Control: $($resource.Url)"
                    }
                    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                    if ((Get-Sha256Hex $bytes) -ne $resource.Hash) { throw "Remote hash mismatch: $($resource.Url)" }
                    $remoteChecks++
                } finally { $response.Dispose(); $request.Dispose() }
            }
        }
    } finally { $client.Dispose(); $handler.Dispose() }
    if ($remoteChecks -ne 666) { throw "Expected 666 remote resources, verified $remoteChecks" }
    $remoteVerified = $true
}

$attestationFile = Resolve-ProjectPath $AttestationPath "AttestationPath"
$attestation = [ordered]@{
    schemaVersion = 1
    testedAtUtc = [DateTime]::UtcNow.ToString("o")
    sourceArtAggregateSha256 = $approvedAggregate
    hostedMetadataAggregateSha256 = $manifest.hostedMetadataAggregateSha256
    publicOrigin = $manifest.publicOrigin
    tokenBaseUri = $manifest.tokenBaseUri
    supply = 333
    localResourcesVerified = 666
    remoteResourcesVerified = $remoteChecks
    remoteVerificationPassed = $remoteVerified
    result = if ($remoteVerified) { "passed" } else { "local-only" }
    deploymentAllowed = $remoteVerified
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $attestationFile) | Out-Null
[System.IO.File]::WriteAllText($attestationFile, ($attestation | ConvertTo-Json -Depth 5), $utf8NoBom)
Write-Host "Verified all 333 local Genesis images and metadata files."
if ($Remote) { Write-Host "Verified all 666 remote HTTPS resources with MIME, cache and SHA-256 checks." }
else { Write-Host "Remote verification was not requested; deployment remains blocked." -ForegroundColor Yellow }
Write-Host "No deployment or on-chain action was performed."
