param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(998, 999)]
    [int]$ChainId,

    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,

    [string]$OutputDirectory = "verification-bundle",

    [switch]$Submit,
    [switch]$ConfirmPublicSubmission
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$forge = Join-Path $projectRoot ".tools\foundry\forge.exe"
if (-not (Test-Path -LiteralPath $forge)) {
    throw "Foundry executable not found at $forge"
}

$resolvedManifest = (Resolve-Path -LiteralPath $ManifestPath).Path
$manifest = Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json
if ($manifest.chainId -ne $ChainId) {
    throw "Manifest chainId $($manifest.chainId) does not match requested chain $ChainId"
}

$randomnessContract = if ($ChainId -eq 998) {
    "src/hyperevm/DrandRelayCoordinator.sol:DrandRelayCoordinator"
} else {
    "src/hyperevm/DrandBN254Coordinator.sol:DrandBN254Coordinator"
}

$contracts = [ordered]@{
    fwa = "FWA_ETHEREUM_REFERENCE/FWA/sources/src/FWA.sol:FWA"
    whitelist = "FWA_ETHEREUM_REFERENCE/FWAWhitelist/sources/src/FWAWhitelist.sol:FWAWhitelist"
    vrfService = "FWA_ETHEREUM_REFERENCE/FWAVRFService/sources/src/FWAVRFService.sol:FWAVRFService"
    randomnessCoordinator = $randomnessContract
    randomnessRegistry = "src/hyperevm/DrandEvmnetRegistry.sol:DrandEvmnetRegistry"
    splitter = "src/hyperevm/SplitterHyperEVM.sol:SplitterHyperEVM"
    rewards = "src/hyperevm/FWARewardsHyperEVM.sol:FWARewardsHyperEVM"
    token = "src/hyperevm/FWATokenHyperEVM.sol:FWATokenHyperEVM"
    projectXAdapter = "src/hyperevm/FWAHyperSwapAdapter.sol:FWAHyperSwapAdapter"
    projectXLiquidityLocker = "src/hyperevm/HWAProjectXLiquidityLocker.sol:HWAProjectXLiquidityLocker"
}

$bundleRoot = Join-Path $projectRoot (Join-Path $OutputDirectory $ChainId)
$standardJsonRoot = Join-Path $bundleRoot "standard-json"
New-Item -ItemType Directory -Force -Path $standardJsonRoot | Out-Null

$plan = [ordered]@{
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    chainId = $ChainId
    manifest = $ManifestPath
    verifier = "Sourcify"
    compiler = "0.8.30"
    optimizerRuns = 1
    viaIr = $true
    evmVersion = "cancun"
    submissions = @()
    externalContracts = @(
        [ordered]@{ name = "projectXPool"; address = $manifest.contracts.projectXPool; reason = "Deployed by the Project X factory, not by this repository" }
    )
}

foreach ($entry in $contracts.GetEnumerator()) {
    $name = $entry.Key
    $identifier = $entry.Value
    $address = $manifest.contracts.$name
    if ([string]::IsNullOrWhiteSpace($address) -or $address -eq "0x0000000000000000000000000000000000000000") {
        continue
    }

    $jsonPath = Join-Path $standardJsonRoot "$name.json"
    $arguments = @(
        "verify-contract",
        $address,
        $identifier,
        "--chain", "$ChainId",
        "--verifier", "sourcify",
        "--compiler-version", "0.8.30",
        "--num-of-optimizations", "1",
        "--via-ir",
        "--evm-version", "cancun",
        "--show-standard-json-input"
    )
    $standardJson = & $forge @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Could not build standard JSON input for $name ($identifier)"
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($jsonPath, ($standardJson -join [Environment]::NewLine), $utf8NoBom)

    $plan.submissions += [ordered]@{
        name = $name
        address = $address
        contract = $identifier
        standardJson = "standard-json/$name.json"
        status = "prepared-not-submitted"
    }

    if ($Submit) {
        if (-not $ConfirmPublicSubmission) {
            throw "Public source publication requires both -Submit and -ConfirmPublicSubmission"
        }
        & $forge verify-contract $address $identifier --chain $ChainId --verifier sourcify --compiler-version 0.8.30 --num-of-optimizations 1 --via-ir --evm-version cancun --watch
        if ($LASTEXITCODE -ne 0) {
            throw "Sourcify submission failed for $name at $address"
        }
        $plan.submissions[-1].status = "submitted"
    }
}

$planPath = Join-Path $bundleRoot "verification-plan.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($planPath, ($plan | ConvertTo-Json -Depth 8), $utf8NoBom)
Write-Host "Prepared $($plan.submissions.Count) source-verification entries at $bundleRoot"
if (-not $Submit) {
    Write-Host "No sources were published. Re-run with -Submit -ConfirmPublicSubmission after deployment review."
}
