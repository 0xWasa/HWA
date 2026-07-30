param(
    [string]$OutputPath = "release/audit-manifest.json",
    [string]$Reason = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd("\", "/")
# Every directory that `remappings.txt` resolves to must appear here, otherwise the manifest
# silently omits sources that are compiled into deployed bytecode. `vendor/fwa-reference-union`
# supplies solady (the deployed HWA token's entire ERC-20 implementation, plus Ownable,
# ReentrancyGuard, SafeTransferLib and FixedPointMathLib used by every HyperEVM contract), the
# Chainlink VRF interfaces the coordinator ABI depends on, and the Uniswap v4 TickMath the Project X
# launch path uses. The four extra FWA_ETHEREUM_REFERENCE trees back the rewards, token, hook, claim
# and splitter remappings. `TestReleaseScripts.ps1` asserts this list stays in sync with
# `remappings.txt`.
$roots = @(
    "src", "test", "script", "scripts", "hyperevm-fork-test", "fork-test",
    "frontend/src", "frontend/e2e", "frontend/public/genesis/v1", "frontend/public/genesis/v2",
    "frontend/public/genesis/v3", "frontend/public/genesis/v3-explorations", "frontend/public/brand",
    "indexer/src", "indexer/scripts", "indexer/abis",
    "vendor/fwa-reference-union",
    "FWA_ETHEREUM_REFERENCE/FWA/sources", "FWA_ETHEREUM_REFERENCE/FWAVRFService/sources",
    "FWA_ETHEREUM_REFERENCE/FWAWhitelist/sources", "FWA_ETHEREUM_REFERENCE/FWARewards/sources",
    "FWA_ETHEREUM_REFERENCE/FWATokenHook/sources", "FWA_ETHEREUM_REFERENCE/FWAClaim/sources",
    "FWA_ETHEREUM_REFERENCE/Splitter/sources"
)
$rootFiles = @(
    "foundry.toml", "remappings.txt", ".env.mainnet.example",
    "fork-test/FWAEthereumDifferential.t.sol", "indexer/subgraph.yaml",
    "FWA_PARITY_MANIFEST.md", "MAINNET_RELEASE_RUNBOOK_2026-07-26.md",
    "HWA_MAINNET_CONFIGURATION_FREEZE_2026-07-27.md",
    "HWA_GENESIS_COLLECTION_SPEC_2026-07-27.md",
    "HWA_GENESIS_COLLECTION_V3_SPEC.md",
    "HWA_VPS_HOSTING_RUNBOOK_2026-07-27.md",
    "HWA_VPS_APP_RUNBOOK_2026-07-27.md",
    "ops/nginx/hwa-genesis-v3.conf.example",
    "ops/nginx/hwa-app.conf.example", "ops/nginx/hwa-production.conf", "docker-compose.production.yml",
    "frontend/public/genesis/concepts/hwa-genesis-colossal-v1.png",
    "release/hwa-safe-mainnet-preparation.json",
    "release/hwa-safe-mainnet-deployment.json",
    "release/hwa-launch-economics-preparation.json",
    "release/hwa-mainnet-collections-attestation.json",
    "release/hwa-projectx-launch-price-selection.json",
    "release/hwa-genesis-custody-recipients.json",
    "release/hwa-genesis-canonical.json",
    "release/hwa-genesis-hosting-attestation.json",
    "release/hwa-genesis-safe-actions.json",
    "release/HWA_MAINNET_FREEZE_ADDENDUM_2026-07-27.md",
    "release/HWA_PRELAUNCH_READINESS_2026-07-27.md",
    "RPC_LOGS_PRODUCTION_DECISION_2026-07-27.md", "TESTNET_998_DEPLOYMENTS.md",
    "CLAUDE_AUDIT_HANDOFF_2026-07-26.md", "DRAND_GELATO_RANDOMNESS_RUNBOOK.md",
    "PROJECTX_MIGRATION_PLAN_2026-07-26.md", "PROJECTX_INTEGRATION_RFC.md",
    "PROJECTX_DEPLOYMENT_RUNBOOK.md", "PROJECTX_MAINNET_READINESS_REPORT_2026-07-26.md",
    "frontend/package.json", "frontend/package-lock.json", "frontend/.env.example",
    "frontend/.env.production.example", "frontend/Dockerfile", "frontend/.dockerignore", "frontend/next.config.ts",
    "frontend/eslint.config.mjs", "frontend/playwright.config.ts", "frontend/tsconfig.json",
    "indexer/package.json", "indexer/package-lock.json", "indexer/schema.graphql",
    "indexer/subgraph.template.yaml", "release/release-gate-last-run.json",
    "release/log-rpc-probe-999.json",
    "release/AUDIT_REPORT_2026-07-26.md",
    "release/audit-findings-2026-07-26.json",
    "release/REMEDIATION_REPORT_2026-07-26.md",
    "release/remediation-findings-2026-07-26.json",
    "release/FABLE5_SECURITY_AUDIT_2026-07-27.md",
    "release/fable5-security-findings-2026-07-27.json",
    "release/FABLE5_REMEDIATION_REPORT_2026-07-27.md",
    "release/fable5-remediation-findings-2026-07-27.json",
    "release/CODEX_FABLE5_REVIEW_2026-07-27.md",
    "release/FABLE5_FOLLOWUP_AUDIT_2026-07-27.md",
    "release/FABLE5_FOLLOWUP_FINDINGS_2026-07-27.json",
    "release/FABLE5_FOLLOWUP_TEST_MATRIX_2026-07-27.md",
    "release/FABLE5_FOLLOWUP_MAINNET_VERDICT_2026-07-27.md",
    "release/CODEX_FABLE5_FOLLOWUP_REMEDIATION_2026-07-27.md",
    "release/codex-fable5-followup-remediation-2026-07-27.json",
    "release/gate-fable5-followup-phaseA.json", "release/gate-fable5-followup-phaseC.json",
    "release/SECURITY_FINDINGS_CLOSURE_2026-07-27.md",
    "release/release-gate-testnet-v2-2026-07-27.json",
    "release/release-gate-testnet-v2-live-2026-07-27.json",
    "release/testnet-attestation-998.json", "release/testnet-attestation-projectx-998.json"
)
$extensions = @(".sol", ".ts", ".tsx", ".mjs", ".py", ".ps1", ".json", ".graphql", ".yaml", ".toml", ".md", ".svg", ".html", ".png", ".ico")
$files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
foreach ($root in $roots) {
    $resolved = Join-Path $projectRoot $root
    if (Test-Path -LiteralPath $resolved) {
        foreach ($file in Get-ChildItem -LiteralPath $resolved -File -Recurse) {
            if ($extensions -contains $file.Extension.ToLowerInvariant()) { $files.Add($file) }
        }
    }
}
foreach ($relative in $rootFiles) {
    $resolved = Join-Path $projectRoot $relative
    if (Test-Path -LiteralPath $resolved) { $files.Add((Get-Item -LiteralPath $resolved)) }
}

$entries = $files | Sort-Object FullName -Unique | ForEach-Object {
    $fullName = [System.IO.Path]::GetFullPath($_.FullName)
    $rootPrefix = $projectRoot + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullName.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to include a file outside the project root: $fullName"
    }
    $relative = $fullName.Substring($rootPrefix.Length).Replace("\", "/")
    [ordered]@{
        path = $relative
        bytes = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$resolvedOutput = Join-Path $projectRoot $OutputPath
$previousManifestSha256 = $null
if (Test-Path -LiteralPath $resolvedOutput) {
    if ([string]::IsNullOrWhiteSpace($Reason)) {
        throw "Overwriting an audit manifest requires -Reason so the anchor history remains reviewable"
    }
    $previousManifestSha256 = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256).Hash.ToLowerInvariant()
} elseif ([string]::IsNullOrWhiteSpace($Reason)) {
    $Reason = "initial generation"
}
$payload = [ordered]@{
    schemaVersion = 2
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    containsSecrets = $false
    regenerationReason = $Reason.Trim()
    previousManifestSha256 = $previousManifestSha256
    fileCount = @($entries).Count
    files = @($entries)
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutput) | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$json = (($payload | ConvertTo-Json -Depth 6) -replace "`r`n", "`n") + "`n"
[System.IO.File]::WriteAllText($resolvedOutput, $json, $utf8NoBom)
Write-Host "Wrote audit manifest for $($payload.fileCount) files to $resolvedOutput"
