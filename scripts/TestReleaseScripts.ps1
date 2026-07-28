$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$fixtureRoot = Join-Path $projectRoot "release\script-self-test"
New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
$envFixture = Join-Path $fixtureRoot "fixture.env"
[System.IO.File]::WriteAllText($envFixture, "# self-test`nHWA_RELEASE_SELF_TEST='loaded'`n", (New-Object System.Text.UTF8Encoding($false)))
& (Join-Path $PSScriptRoot "ImportEnvFile.ps1") -Path $envFixture
if ($env:HWA_RELEASE_SELF_TEST -ne "loaded") { throw "ImportEnvFile self-test failed" }
Remove-Item Env:HWA_RELEASE_SELF_TEST

$addresses = 1..12 | ForEach-Object { "0x" + $_.ToString("x").PadLeft(40, "0") }
$collection = '[{"address":"0x000000000000000000000000000000000000000c","name":"Audit Fixture","symbol":"AUD","deploymentBlock":1}]'
$manifestRelative = "release/script-self-test/mainnet.json"

& (Join-Path $PSScriptRoot "WriteMainnetManifest.ps1") `
    -Fwa $addresses[0] -Whitelist $addresses[1] -VrfService $addresses[2] `
    -RandomnessCoordinator $addresses[3] -RandomnessRegistry $addresses[4] -Splitter $addresses[5] -Rewards $addresses[6] `
    -Token $addresses[7] -ProjectXAdapter $addresses[8] -ProjectXPool $addresses[9] `
    -ProjectXLiquidityLocker $addresses[10] `
    -SnapshotNft $addresses[11] -SnapshotDeploymentBlock 1 -SnapshotMaxTokenId 333 `
    -DeployedAtBlock 1 -CollectionsJson $collection -ProjectXTradeUrl "https://example.com/projectx-fixture" `
    -OutputPath $manifestRelative

$manifestPath = Join-Path $projectRoot $manifestRelative
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.chainId -ne 999 -or $manifest.features.writesEnabled -or $manifest.features.acquisitionsEnabled) {
    throw "Fail-closed manifest invariant failed"
}

$noLinksRelative = "release/script-self-test/mainnet-no-links.json"
& (Join-Path $PSScriptRoot "WriteMainnetManifest.ps1") `
    -Fwa $addresses[0] -Whitelist $addresses[1] -VrfService $addresses[2] `
    -RandomnessCoordinator $addresses[3] -RandomnessRegistry $addresses[4] -Splitter $addresses[5] -Rewards $addresses[6] `
    -Token $addresses[7] -ProjectXAdapter $addresses[8] -ProjectXPool $addresses[9] `
    -ProjectXLiquidityLocker $addresses[10] `
    -SnapshotNft $addresses[11] -SnapshotDeploymentBlock 1 -SnapshotMaxTokenId 333 `
    -DeployedAtBlock 1 -CollectionsJson $collection -OutputPath $noLinksRelative
$noLinks = Get-Content -LiteralPath (Join-Path $projectRoot $noLinksRelative) -Raw | ConvertFrom-Json
if ($noLinks.PSObject.Properties.Name -contains "links") { throw "Optional links must be omitted rather than serialized as null" }

$actionsRelative = "release/script-self-test/owner-actions.json"
& (Join-Path $PSScriptRoot "PrepareMainnetOwnerActions.ps1") `
    -Fwa $addresses[0] -Whitelist $addresses[1] -Rewards $addresses[6] -Token $addresses[7] -Splitter $addresses[5] `
    -Collections @("0x0000000000000000000000000000000000000012") `
    -CanaryCollection "0x0000000000000000000000000000000000000012" `
    -OfflineTemplate -OutputPath $actionsRelative
$actions = Get-Content -LiteralPath (Join-Path $projectRoot $actionsRelative) -Raw | ConvertFrom-Json
if ($actions.executable -or $actions.onchainValidation.performed -or -not $actions.preActivation.data `
    -or @($actions.activationTemplate).Count -ne 4 -or @($actions.activationBatch).Count -ne 4 `
    -or @($actions.emergencyPause).Count -ne 3 -or -not $actions.manualTradingControls.open.data `
    -or -not $actions.manualTradingControls.close.data -or $actions.postCanaryPublicCollectionsExecutable `
    -or $actions.canaryCollection -ne "0x0000000000000000000000000000000000000012") {
    throw "Safe action separation invariant failed"
}

$promotionScript = Join-Path $PSScriptRoot "PromoteMainnetManifest.ps1"
$preparedReportRelative = "release/script-self-test/prepared-report.json"
$preparedReportPath = Join-Path $projectRoot $preparedReportRelative
[System.IO.File]::WriteAllText(
    $preparedReportPath,
    (@{ status = "prepared"; chainTarget = 999 } | ConvertTo-Json),
    (New-Object System.Text.UTF8Encoding($false))
)
$promotionParams = @{
    ManifestPath = $manifestRelative
    ReleaseReportPath = $preparedReportRelative
    PublicIndexerUrl = "https://api.goldsky.com/api/public/fixture/subgraphs/hwa/1.0/gn"
    RpcUrl = "https://rpc.hyperliquid.xyz/evm"
    ConfirmOnchainActivation = $true
    ConfirmDrandHealthy = $true
    ConfirmProjectXVerified = $true
    ConfirmIndexerHealthy = $true
    ConfirmMainnetE2E = $true
}
foreach ($confirmation in @(
    "ConfirmOnchainActivation",
    "ConfirmDrandHealthy",
    "ConfirmProjectXVerified",
    "ConfirmIndexerHealthy",
    "ConfirmMainnetE2E"
)) {
    $negativeParams = @{} + $promotionParams
    $negativeParams.Remove($confirmation)
    $rejected = $false
    try {
        & $promotionScript @negativeParams
    } catch {
        if ($_.Exception.Message -like "All five independent confirmations are required*") { $rejected = $true }
        else { throw }
    }
    if (-not $rejected) { throw "Promotion gate accepted missing confirmation: $confirmation" }
}

$preparedRejected = $false
try {
    & $promotionScript @promotionParams
} catch {
    if ($_.Exception.Message -like "Release report must be a fully passed*") { $preparedRejected = $true }
    else { throw }
}
if (-not $preparedRejected) { throw "Promotion accepted a non-passed release report" }
$stillClosed = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($stillClosed.features.writesEnabled -or $stillClosed.features.acquisitionsEnabled) {
    throw "Rejected promotion mutated the fail-closed manifest"
}

# Every remapping target must sit inside a manifest root. Without this, sources that are compiled
# into deployed bytecode (solady supplies the HWA token's whole ERC-20 implementation) can be
# swapped without the SHA-256 anchor noticing, and the manifest cannot be used to prove that the
# audited source set is the deployed source set.
$rootsBlock = [regex]::Match(
    [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "CreateAuditManifest.ps1")),
    '\$roots\s*=\s*@\((?<body>[^)]*)\)'
).Groups["body"].Value
$declaredRoots = [regex]::Matches($rootsBlock, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
if (@($declaredRoots).Count -eq 0) { throw "Could not parse manifest roots from CreateAuditManifest.ps1" }

$remappingTargets = @(
    Get-Content -LiteralPath (Join-Path $projectRoot "remappings.txt") |
        Where-Object { $_ -match '=' } |
        ForEach-Object { ($_ -split '=', 2)[1].Trim().TrimEnd('/') } |
        Where-Object { $_ }
)
foreach ($target in $remappingTargets) {
    $covered = $false
    foreach ($root in $declaredRoots) {
        $normalizedRoot = $root.TrimEnd('/')
        if ($target -eq $normalizedRoot -or $target.StartsWith($normalizedRoot + "/")) { $covered = $true; break }
    }
    if (-not $covered) {
        throw "Remapping target '$target' is outside every audit-manifest root; deployed source would go unhashed"
    }
}

# The anchor must also actually cover what it claims: no drift, no missing file.
$auditManifestPath = Join-Path $projectRoot "release/audit-manifest.json"
if (Test-Path -LiteralPath $auditManifestPath) {
    $auditManifest = Get-Content -LiteralPath $auditManifestPath -Raw | ConvertFrom-Json
    $solidityEntries = @($auditManifest.files | Where-Object { $_.path -like "vendor/fwa-reference-union/lib/solady/*" })
    if ($solidityEntries.Count -eq 0) {
        throw "audit-manifest.json does not hash solady, which is compiled into every deployed contract"
    }
}

$genesisCanonicalPath = Join-Path $projectRoot "release/hwa-genesis-canonical.json"
$genesisHostingAttestationPath = Join-Path $projectRoot "release/hwa-genesis-hosting-attestation.json"
$genesisNginxPath = Join-Path $projectRoot "ops/nginx/hwa-genesis-v3.conf.example"
$appNginxPath = Join-Path $projectRoot "ops/nginx/hwa-app.conf.example"
$appDockerfilePath = Join-Path $projectRoot "frontend/Dockerfile"
$appComposePath = Join-Path $projectRoot "docker-compose.production.yml"
foreach ($requiredPath in @(
    $genesisCanonicalPath,
    $genesisHostingAttestationPath,
    $genesisNginxPath,
    $appNginxPath,
    $appDockerfilePath,
    $appComposePath,
    (Join-Path $PSScriptRoot "PrepareHWAGenesisHosting.ps1"),
    (Join-Path $PSScriptRoot "VerifyHWAGenesisHosting.ps1"),
    (Join-Path $PSScriptRoot "PrepareHWAGenesisSafeActions.ps1"),
    (Join-Path $PSScriptRoot "VerifyHWAGenesisOnchain.ps1"),
    (Join-Path $PSScriptRoot "SelectHWAProjectXLaunchPrice.ps1")
)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "Missing release helper: $requiredPath" }
}
$genesisCanonical = Get-Content -LiteralPath $genesisCanonicalPath -Raw | ConvertFrom-Json
if (
    $genesisCanonical.schemaVersion -ne 2 -or -not $genesisCanonical.canonical `
        -or $genesisCanonical.supply -ne 333 -or $genesisCanonical.hosting.mode -ne "versioned HTTPS VPS" `
        -or $genesisCanonical.visualApproval.sourceArtAggregateSha256 `
            -ne "96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648" `
        -or $genesisCanonical.tokenUriCompatibility.metadataFileNames -ne "1..333 with no extension" `
        -or $genesisCanonical.deploymentAllowed
) { throw "Genesis canonical hosting report is missing or no longer fail-closed" }
$genesisLocalAttestation = Get-Content -LiteralPath $genesisHostingAttestationPath -Raw | ConvertFrom-Json
$genesisPreVpsState = $genesisLocalAttestation.result -eq "local-only" `
    -and -not $genesisLocalAttestation.deploymentAllowed `
    -and $genesisLocalAttestation.remoteResourcesVerified -eq 0
$genesisHostedState = $genesisLocalAttestation.result -eq "passed" `
    -and $genesisLocalAttestation.deploymentAllowed `
    -and $genesisLocalAttestation.remoteResourcesVerified -eq 666 `
    -and $genesisLocalAttestation.publicOrigin -eq "https://assets.hwa.fun"
if (
    $genesisLocalAttestation.supply -ne 333 -or $genesisLocalAttestation.localResourcesVerified -ne 666 `
        -or (-not $genesisPreVpsState -and -not $genesisHostedState)
) { throw "Genesis hosting attestation is neither the fail-closed pre-VPS state nor the verified production state" }
$nginxPolicy = Get-Content -LiteralPath $genesisNginxPath -Raw
if ($nginxPolicy -notmatch 'max-age=31536000, immutable' -or $nginxPolicy -notmatch 'application/json' `
    -or $nginxPolicy -notmatch 'image/svg\+xml' -or $nginxPolicy -notmatch 'limit_except GET HEAD') {
    throw "Genesis Nginx policy lost an immutable-cache, MIME or method restriction"
}
$appDockerfile = Get-Content -LiteralPath $appDockerfilePath -Raw
$appCompose = Get-Content -LiteralPath $appComposePath -Raw
$appNginx = Get-Content -LiteralPath $appNginxPath -Raw
if ($appDockerfile -notmatch 'npm run build:standalone' -or $appDockerfile -notmatch 'USER nextjs' `
    -or $appCompose -notmatch 'read_only: true' -or $appCompose -notmatch 'no-new-privileges:true' `
    -or $appCompose -notmatch '127\.0\.0\.1:3900:3900' -or $appCompose -notmatch 'cap_drop:' `
    -or $appNginx -notmatch 'limit_req zone=hwa_api' -or $appNginx -notmatch 'proxy_pass http://127\.0\.0\.1:3900') {
    throw "VPS application packaging lost a build, isolation, loopback or edge-rate-limit control"
}

$genesisSafeFixtureRelative = "release/script-self-test/genesis-safe-actions.json"
& (Join-Path $PSScriptRoot "PrepareHWAGenesisSafeActions.ps1") `
    -Collection "0x0000000000000000000000000000000000000001" `
    -BaseUri "https://assets.example.invalid/hwa-genesis/v3/96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648/metadata/" `
    -OfflineTemplate -OutputPath $genesisSafeFixtureRelative
$genesisSafeFixture = Get-Content -LiteralPath (Join-Path $projectRoot $genesisSafeFixtureRelative) -Raw | ConvertFrom-Json
if ($genesisSafeFixture.broadcast -or $genesisSafeFixture.executable -or @($genesisSafeFixture.actions).Count -ne 5 `
    -or $genesisSafeFixture.actions[4].data -ne "0xab471434") {
    throw "Genesis Safe action generator is not fail-closed or emitted unexpected calldata"
}

$pricePreviewPath = Join-Path $projectRoot "release/hwa-projectx-launch-price-selection.json"
if (Test-Path -LiteralPath $pricePreviewPath) {
    $pricePreview = Get-Content -LiteralPath $pricePreviewPath -Raw | ConvertFrom-Json
    if ($pricePreview.chainId -ne 999 -or $pricePreview.targetFdvHype -ne "640" `
        -or $pricePreview.minimumFdvHype -ne "600" -or $pricePreview.maximumFdvHype -ne "700" `
        -or $pricePreview.broadcastPerformed) {
        throw "Project X nonce-bound price preview is invalid"
    }
}

Write-Host "Release helper self-tests passed without broadcast."
