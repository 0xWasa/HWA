param(
    [switch]$CleanInstall,
    [switch]$SkipFork,
    [switch]$SkipE2E,
    [switch]$VerifyLiveTestnet,
    [switch]$MainnetMode,
    [string]$MainnetEnvPath,
    [string]$ReportPath = "release/release-gate-last-run.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$forge = Join-Path $projectRoot ".tools\foundry\forge.exe"
$cast = Join-Path $projectRoot ".tools\foundry\cast.exe"
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $forge)) { throw "Foundry not found at $forge" }
if (-not (Test-Path -LiteralPath $cast)) { throw "Cast not found at $cast" }
$results = New-Object System.Collections.ArrayList
$failed = $false
$broadcastRequested = $false
$broadcastCapableSteps = 0
$secretsScrubbed = @()
$minimumCounts = [ordered]@{ solidity = 121; fork = 2; compatibilityFork = 4; vitest = 46; playwright = 32 }

function Invoke-GateStep(
    [string]$Name,
    [string]$WorkingDirectory,
    [string]$Executable,
    [string[]]$Arguments,
    [string]$CountPattern = "",
    [int]$MinimumCount = 0
) {
    if ($Arguments -contains "--broadcast") {
        $script:broadcastRequested = $true
        $script:broadcastCapableSteps++
        [void]$results.Add([ordered]@{
            name = $Name
            status = "failed"
            exitCode = $null
            durationSeconds = 0
            command = [IO.Path]::GetFileName($Executable)
            arguments = $Arguments
            reason = "broadcast-capable argument rejected before execution"
        })
        throw "Broadcast-capable argument rejected by the release gate: $Name"
    }
    Write-Host "`n== $Name ==" -ForegroundColor Cyan
    $started = [DateTime]::UtcNow
    Push-Location $WorkingDirectory
    try {
        # Windows PowerShell 5 wraps native stderr lines (including harmless npm
        # deprecation warnings) as non-terminating ErrorRecord objects. Capture
        # them in the report and use the native exit code as the gate result.
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $outputLines = @(& $Executable @Arguments 2>&1)
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        $outputLines | ForEach-Object { Write-Host $_ }
    } finally {
        Pop-Location
    }
    $duration = ([DateTime]::UtcNow - $started).TotalSeconds
    $observedCount = $null
    $countPassed = $true
    if ($CountPattern) {
        $matches = [regex]::Matches(($outputLines -join "`n"), $CountPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($matches.Count -gt 0) {
            $observedCount = ($matches | ForEach-Object { [int]$_.Groups[1].Value } | Measure-Object -Maximum).Maximum
        }
        $countPassed = $null -ne $observedCount -and $observedCount -ge $MinimumCount
    }
    $status = if ($exitCode -eq 0 -and $countPassed) { "passed" } else { "failed" }
    $step = [ordered]@{
        name = $Name
        status = $status
        exitCode = $exitCode
        durationSeconds = [Math]::Round($duration, 2)
        command = [IO.Path]::GetFileName($Executable)
        arguments = $Arguments
    }
    if ($CountPattern) {
        $step.minimumExpectedCount = $MinimumCount
        $step.observedCount = $observedCount
    }
    [void]$results.Add($step)
    if ($exitCode -ne 0) { throw "$Name failed with exit code $exitCode" }
    if (-not $countPassed) { throw "$Name did not prove its minimum test count of $MinimumCount (observed: $observedCount)" }
}

function Add-GateSkip([string]$Name, [string]$Reason) {
    [void]$results.Add([ordered]@{
        name = $Name
        status = "skipped"
        reason = $Reason
        durationSeconds = 0
    })
    Write-Host "`n== $Name ==" -ForegroundColor Yellow
    Write-Host "SKIPPED: $Reason" -ForegroundColor Yellow
}

function Get-StableForkBlock([string]$Name, [string]$RpcUrl) {
    # HyperEVM providers may briefly advertise a head whose block body is not
    # readable yet. Pin forks behind the advertised head so a provider race
    # cannot turn a deterministic compatibility test into a false failure.
    $headOutput = @(& $cast block-number --rpc-url $RpcUrl 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Unable to resolve a stable $Name fork block" }
    [long]$head = ($headOutput | Select-Object -Last 1).ToString().Trim()
    if ($head -le 20) { throw "$Name head is too low for a stable fork snapshot" }
    return $head - 20
}

try {
    if ($MainnetMode) {
        if (-not $MainnetEnvPath) { throw "-MainnetMode requires -MainnetEnvPath" }
        $rootDotEnv = Join-Path $projectRoot ".env"
        if (Test-Path -LiteralPath $rootDotEnv) {
            throw "MainnetMode refuses a workspace-root .env. Move the testnet file out of the workspace before the final gate."
        }
        & (Join-Path $PSScriptRoot "ImportEnvFile.ps1") -Path $MainnetEnvPath
        if ($env:FWA_CHAIN_ID -and [int]$env:FWA_CHAIN_ID -ne 999) { throw "Mainnet env targets chain $($env:FWA_CHAIN_ID), expected 999" }
        if ($env:NEXT_PUBLIC_HYPEREVM_LOG_RPC_URL -ne "/api/rpc/logs") {
            throw "MainnetMode requires NEXT_PUBLIC_HYPEREVM_LOG_RPC_URL for indexer-independent emergency discovery"
        }
        $logRuntimeAttested = $env:HYPEREVM_LOG_RPC_RUNTIME_ATTESTED -eq "true"
        if (-not $env:HYPEREVM_LOG_RPC_PROVIDER -or (-not $env:HYPEREVM_LOG_RPC_UPSTREAM_URL -and -not $logRuntimeAttested)) {
            throw "MainnetMode requires either the server-only archive/log RPC URL or its explicit runtime attestation"
        }
        if ($env:HYPEREVM_LOG_RPC_UPSTREAM_URL -and $env:HYPEREVM_LOG_RPC_UPSTREAM_URL -eq $env:NEXT_PUBLIC_HYPEREVM_RPC_URL) {
            throw "The emergency log RPC upstream must be independent from the primary HyperEVM RPC"
        }
        if (-not $env:HYPEREVM_LOG_RPC_ALLOWED_ADDRESSES -or $env:HYPEREVM_LOG_RPC_ALLOWED_ADDRESSES -notmatch '^0x[0-9a-fA-F]{40}(,0x[0-9a-fA-F]{40})*$') {
            throw "MainnetMode requires a strict HYPEREVM_LOG_RPC_ALLOWED_ADDRESSES allowlist"
        }
        $logRange = 0
        $serverLogRange = 0
        if (-not [int]::TryParse($env:NEXT_PUBLIC_HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE, [ref]$logRange) -or $logRange -lt 1000) {
            throw "MainnetMode requires a reviewed log RPC range of at least 1000 blocks"
        }
        if (-not [int]::TryParse($env:HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE, [ref]$serverLogRange) -or $serverLogRange -ne $logRange) {
            throw "Public and server log RPC range policies must match"
        }
        $logAttestationPath = if ($env:HYPEREVM_LOG_RPC_ATTESTATION_PATH) { $env:HYPEREVM_LOG_RPC_ATTESTATION_PATH } else { "release/log-rpc-probe-999.json" }
        if (-not [IO.Path]::IsPathRooted($logAttestationPath)) { $logAttestationPath = Join-Path $projectRoot $logAttestationPath }
        if (-not (Test-Path -LiteralPath $logAttestationPath)) { throw "Missing production log RPC attestation: $logAttestationPath" }
        $logAttestation = Get-Content -LiteralPath $logAttestationPath -Raw | ConvertFrom-Json
        $testedAt = [DateTimeOffset]::MinValue
        $attestationDateValid = [DateTimeOffset]::TryParse($logAttestation.testedAtUtc, [ref]$testedAt)
        $attestationInvalid = $logAttestation.result -ne "passed" -or [int]$logAttestation.chainId -ne 999 -or $logAttestation.provider -ne $env:HYPEREVM_LOG_RPC_PROVIDER -or [int]$logAttestation.getLogsRangeBlocks -ne $logRange -or [long]$logAttestation.archiveDepthBlocks -lt 1000000 -or -not $attestationDateValid -or ([DateTimeOffset]::UtcNow - $testedAt).TotalDays -gt 7
        if ($attestationInvalid) { throw "Production log RPC attestation is stale or does not match the configured provider/range" }
        if ($env:HYPEREVM_LOG_RPC_UPSTREAM_URL) {
            $upstreamUri = [Uri]$env:HYPEREVM_LOG_RPC_UPSTREAM_URL
            if ($upstreamUri.Scheme -ne "https" -or $upstreamUri.UserInfo -or $logAttestation.endpointHost -ne $upstreamUri.Host) {
                throw "Production log RPC attestation endpoint does not match the configured credential-free HTTPS URL"
            }
            $hash = [Security.Cryptography.SHA256]::Create()
            try {
                $fingerprintBytes = [Text.Encoding]::UTF8.GetBytes($env:HYPEREVM_LOG_RPC_UPSTREAM_URL)
                $configuredFingerprint = ([BitConverter]::ToString($hash.ComputeHash($fingerprintBytes))).Replace("-", "").ToLowerInvariant()
            } finally { $hash.Dispose() }
            if ($configuredFingerprint -ne $logAttestation.endpointFingerprintSha256) {
                throw "Production log RPC URL fingerprint does not match its attestation"
            }
        } else {
            if ($env:HYPEREVM_LOG_RPC_UPSTREAM_HOST -ne $logAttestation.endpointHost `
                -or $env:HYPEREVM_LOG_RPC_UPSTREAM_FINGERPRINT_SHA256 -ne $logAttestation.endpointFingerprintSha256) {
                throw "Runtime log RPC host/fingerprint does not match the reviewed archive attestation"
            }
            $probeUri = [Uri]$env:HYPEREVM_LOG_RPC_PUBLIC_PROBE_URL
            if ($probeUri.Scheme -ne "https" -or $probeUri.UserInfo -or -not $env:FWA_ADDRESS -or -not $env:FWA_MAINNET_DEPLOYMENT_BLOCK) {
                throw "Runtime-attested log RPC mode requires a credential-free HTTPS probe and deployed FWA binding"
            }
            $probeBlock = [long]$env:FWA_MAINNET_DEPLOYMENT_BLOCK
            $probeHex = "0x{0:x}" -f $probeBlock
            $probeBody = [ordered]@{
                jsonrpc = "2.0"; id = 1; method = "eth_getLogs"
                params = @([ordered]@{ address = $env:FWA_ADDRESS; fromBlock = $probeHex; toBlock = $probeHex })
            } | ConvertTo-Json -Depth 8 -Compress
            $probeResponse = Invoke-RestMethod -Uri $probeUri -Method Post -ContentType "application/json" -Body $probeBody -TimeoutSec 20
            if ($probeResponse.error -or $null -eq $probeResponse.result) {
                throw "The public bounded log RPC runtime probe failed"
            }
        }

        # Genesis metadata is frozen forever on-chain. Refuse mainnet readiness until the exact
        # versioned HTTPS package has been fetched byte-for-byte from the production VPS.
        if (-not $env:HWA_GENESIS_V3_PUBLIC_ORIGIN -or -not $env:HWA_GENESIS_NFT_BASE_URI) {
            throw "MainnetMode requires the reviewed Genesis HTTPS origin and final token base URI"
        }
        $genesisOrigin = [Uri]$env:HWA_GENESIS_V3_PUBLIC_ORIGIN
        $genesisBaseUri = [Uri]$env:HWA_GENESIS_NFT_BASE_URI
        if ($genesisOrigin.Scheme -ne "https" -or $genesisOrigin.UserInfo -or $genesisOrigin.AbsolutePath -ne "/" `
            -or $genesisBaseUri.Scheme -ne "https" -or $genesisBaseUri.UserInfo) {
            throw "Genesis hosting must use a credential-free HTTPS origin and base URI"
        }
        $expectedGenesisPath = "/hwa-genesis/v3/96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648/metadata/"
        if ($genesisBaseUri.Host -ne $genesisOrigin.Host -or $genesisBaseUri.AbsolutePath -ne $expectedGenesisPath `
            -or $genesisBaseUri.Query -or $genesisBaseUri.Fragment) {
            throw "Genesis base URI does not match the approved, versioned v3 path"
        }
        $genesisAttestationPath = if ($env:HWA_GENESIS_V3_HOSTING_ATTESTATION_PATH) {
            $env:HWA_GENESIS_V3_HOSTING_ATTESTATION_PATH
        } else { "release/hwa-genesis-hosting-attestation.json" }
        if (-not [IO.Path]::IsPathRooted($genesisAttestationPath)) {
            $genesisAttestationPath = Join-Path $projectRoot $genesisAttestationPath
        }
        if (-not (Test-Path -LiteralPath $genesisAttestationPath)) {
            throw "Missing Genesis hosting attestation: $genesisAttestationPath"
        }
        $genesisAttestation = Get-Content -LiteralPath $genesisAttestationPath -Raw | ConvertFrom-Json
        $genesisTestedAt = [DateTimeOffset]::MinValue
        $genesisDateValid = [DateTimeOffset]::TryParse($genesisAttestation.testedAtUtc, [ref]$genesisTestedAt)
        $genesisAttestationInvalid = $genesisAttestation.result -ne "passed" `
            -or -not $genesisAttestation.remoteVerificationPassed -or -not $genesisAttestation.deploymentAllowed `
            -or [int]$genesisAttestation.supply -ne 333 -or [int]$genesisAttestation.remoteResourcesVerified -ne 666 `
            -or $genesisAttestation.sourceArtAggregateSha256 -ne "96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648" `
            -or $genesisAttestation.publicOrigin -ne $genesisOrigin.GetLeftPart([UriPartial]::Authority).TrimEnd("/") `
            -or $genesisAttestation.tokenBaseUri -ne $env:HWA_GENESIS_NFT_BASE_URI `
            -or -not $genesisDateValid -or ([DateTimeOffset]::UtcNow - $genesisTestedAt).TotalDays -gt 7
        if ($genesisAttestationInvalid) {
            throw "Genesis hosting attestation is stale, incomplete or does not match the configured final URL"
        }

        # ImportEnvFile loads the mainnet file wholesale, including the funded deployer key. This
        # gate is broadcast-forbidden and therefore never needs a signing key, but it does invoke
        # npm, whose lifecycle scripts run arbitrary third-party code with this process environment
        # inherited. Drop every secret before the first child process starts.
        $scrubbed = @()
        foreach ($entry in @(Get-ChildItem Env: | Where-Object { $_.Name -match 'PRIVATE_KEY|MNEMONIC|SECRET|PASSWORD|SEED_PHRASE|_TOKEN$|API_KEY' })) {
            Remove-Item -LiteralPath ("Env:" + $entry.Name) -ErrorAction SilentlyContinue
            $scrubbed += $entry.Name
        }
        if ($scrubbed.Count -gt 0) {
            Write-Host "Scrubbed $($scrubbed.Count) secret variable(s) before running child processes: $($scrubbed -join ', ')" -ForegroundColor Yellow
        }
        $secretsScrubbed = $scrubbed
    }
    if ($CleanInstall) {
        Invoke-GateStep "frontend npm ci" (Join-Path $projectRoot "frontend") $npm @("ci")
        Invoke-GateStep "indexer npm ci" (Join-Path $projectRoot "indexer") $npm @("ci")
    }

    Invoke-GateStep "Solidity formatting" $projectRoot $forge @("fmt", "--check")
    # Compile every source first, including deployment scripts and tests. Size enforcement is
    # intentionally scoped to deployable production contracts: Forge otherwise applies EIP-170
    # to Script contracts too, even though those helper bytecodes are never broadcast/deployed.
    Invoke-GateStep "Solidity full build" $projectRoot $forge @("build")
    Invoke-GateStep "Solidity production contract sizes" $projectRoot $forge @("build", "--sizes", "--skip", "script", "test")
    Invoke-GateStep "Solidity full tests" $projectRoot $forge @("test", "-vv") '(\d+) tests passed' $minimumCounts.solidity
    Invoke-GateStep "Release helper self-tests" $projectRoot $powershell @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "TestReleaseScripts.ps1")
    )

    if (-not $SkipFork) {
        $previousProfile = $env:FOUNDRY_PROFILE
        $env:FOUNDRY_PROFILE = "hyperevm"
        try {
            # The same-origin read proxy terminates the production provider
            # credential on the VPS; no Alchemy secret is copied into this
            # report or passed on the command line.
            $mainnetForkRpc = "https://hwa.fun/api/rpc/read"
            $testnetForkRpc = "https://rpc.hyperliquid-testnet.xyz/evm"
            $mainnetForkBlock = Get-StableForkBlock "chain-999" $mainnetForkRpc
            $testnetForkBlock = Get-StableForkBlock "chain-998" $testnetForkRpc
            Invoke-GateStep "Project X mainnet fork simulation" $projectRoot $forge @(
                "test", "--fork-url", $mainnetForkRpc, "--fork-block-number", "$mainnetForkBlock",
                "--match-contract", "ProjectXDeploymentTest", "-vv"
            ) '(\d+) tests passed' $minimumCounts.fork
            Invoke-GateStep "V3 testnet compatibility fork simulation" $projectRoot $forge @(
                "test", "--fork-url", $testnetForkRpc, "--fork-block-number", "$testnetForkBlock",
                "--match-contract", "HyperSwapDeploymentTest", "-vv"
            ) '(\d+) tests passed' $minimumCounts.compatibilityFork
        } finally {
            if ($null -eq $previousProfile) { Remove-Item Env:FOUNDRY_PROFILE -ErrorAction SilentlyContinue }
            else { $env:FOUNDRY_PROFILE = $previousProfile }
        }
    } else {
        # A step that did not run must never be reported as validated: recording the skip is what
        # forces the overall status to "prepared" instead of "passed".
        Add-GateSkip "Project X mainnet fork simulation" "-SkipFork was requested; chain-999 compatibility is unverified in this run"
        Add-GateSkip "V3 testnet compatibility fork simulation" "-SkipFork was requested; chain-998 venue compatibility is unverified in this run"
    }

    $frontend = Join-Path $projectRoot "frontend"
    Invoke-GateStep "Frontend dependency audit" $frontend $npm @("audit", "--audit-level=high")
    Invoke-GateStep "Frontend typecheck" $frontend $npm @("run", "typecheck")
    Invoke-GateStep "Frontend lint" $frontend $npm @("run", "lint")
    Invoke-GateStep "Frontend unit tests" $frontend $npm @("test") 'Tests\s+(\d+)\s+passed' $minimumCounts.vitest
    Invoke-GateStep "Frontend production build" $frontend $npm @("run", "build")
    if (-not $SkipE2E) {
        Invoke-GateStep "Frontend Playwright E2E" $frontend $npm @("run", "test:e2e") '(\d+)\s+passed' $minimumCounts.playwright
    } else {
        Add-GateSkip "Frontend Playwright E2E" "-SkipE2E was requested; end-to-end flows are unverified in this run"
    }

    $indexer = Join-Path $projectRoot "indexer"
    Invoke-GateStep "Indexer production dependency audit" $indexer $npm @("audit", "--omit=dev", "--audit-level=high")
    Invoke-GateStep "Indexer deterministic build" $indexer $npm @("run", "check")
    $mainnetManifest = Join-Path $projectRoot "frontend\public\deployments\hyperevm-mainnet-999.json"
    if (Test-Path -LiteralPath $mainnetManifest) {
        Invoke-GateStep "Indexer mainnet deterministic build" $indexer $npm @("run", "check:mainnet")
    } elseif ($MainnetMode) {
        throw "MainnetMode requires the deployed chain-999 manifest at $mainnetManifest"
    } else {
        Add-GateSkip "Indexer mainnet deterministic build" "pre-deployment: no chain-999 addresses or manifest exist yet"
    }

    if ($MainnetMode) {
        $mainnetVerificationBlock = Get-StableForkBlock "chain-999 live attestation" "https://hwa.fun/api/rpc/read"
        Invoke-GateStep "Live 999 core attestation" $projectRoot $forge @(
            "script", "script/VerifyHyperEVMCore.s.sol:VerifyHyperEVMCore", "--rpc-url", "hyperevm_mainnet",
            "--fork-block-number", "$mainnetVerificationBlock", "-vv"
        )
        Invoke-GateStep "Live 999 drand BN254 attestation" $projectRoot $forge @(
            "script", "script/VerifyDrandBN254Coordinator.s.sol:VerifyDrandBN254Coordinator", "--rpc-url", "hyperevm_mainnet",
            "--fork-block-number", "$mainnetVerificationBlock", "-vv"
        )
        Invoke-GateStep "Live 999 Project X attestation" $projectRoot $forge @(
            "script", "script/VerifyProjectXModules.s.sol:VerifyProjectXModules", "--rpc-url", "hyperevm_mainnet",
            "--fork-block-number", "$mainnetVerificationBlock", "-vv"
        )
        Invoke-GateStep "Live 999 activation-readiness attestation" $projectRoot $forge @(
            "script", "script/ActivateHyperEVMMainnet.s.sol:ActivateHyperEVMMainnet", "--rpc-url", "hyperevm_mainnet",
            "--fork-block-number", "$mainnetVerificationBlock", "-vv"
        )
    }

    if ($VerifyLiveTestnet) {
        # HyperEVM's public RPC can briefly advertise a head whose body is not yet available.
        # Pin every verifier to the same finalized-enough snapshot instead of racing `latest`.
        $testnetHeadOutput = @(& $cast block-number --rpc-url hyperevm_testnet 2>&1)
        if ($LASTEXITCODE -ne 0) { throw "Unable to resolve a stable chain-998 verification block" }
        [long]$testnetHead = ($testnetHeadOutput | Select-Object -Last 1).ToString().Trim()
        if ($testnetHead -le 20) { throw "Chain-998 head is too low for a stable verification snapshot" }
        $testnetVerificationBlock = $testnetHead - 20
        Invoke-GateStep "Live 998 core attestation" $projectRoot $forge @(
            "script", "script/VerifyHyperEVMCore.s.sol:VerifyHyperEVMCore", "--rpc-url", "hyperevm_testnet", "--fork-block-number", "$testnetVerificationBlock", "-vv"
        )
        Invoke-GateStep "Live 998 drand BN254 attestation" $projectRoot $forge @(
            "script", "script/VerifyDrandBN254Coordinator.s.sol:VerifyDrandBN254Coordinator", "--rpc-url", "hyperevm_testnet", "--fork-block-number", "$testnetVerificationBlock", "-vv"
        )
        Invoke-GateStep "Live 998 Project X-compatible attestation" $projectRoot $forge @(
            "script", "script/VerifyProjectXModules.s.sol:VerifyProjectXModules", "--rpc-url", "hyperevm_testnet", "--fork-block-number", "$testnetVerificationBlock", "-vv"
        )
        Invoke-GateStep "Live 998 v2 post-E2E attestation" $projectRoot $forge @(
            "script", "script/VerifyProjectXTestnetV2Release.s.sol:VerifyProjectXTestnetV2Release", "--rpc-url", "hyperevm_testnet", "--fork-block-number", "$testnetVerificationBlock", "-vv"
        )
    }
} catch {
    $failed = $true
    Write-Error $_
} finally {
    $broadcastPerformed = @(
        $results | Where-Object { @($_.arguments) -contains "--broadcast" }
    ).Count -gt 0
    $skippedCount = @($results | Where-Object { $_.status -eq "skipped" }).Count
    $report = [ordered]@{
        schemaVersion = 2
        generatedAtUtc = [DateTime]::UtcNow.ToString("o")
        status = if ($failed) { "failed" } elseif ($skippedCount -gt 0) { "prepared" } else { "passed" }
        chainTarget = 999
        invocation = [ordered]@{
            cleanInstall = [bool]$CleanInstall
            skipFork = [bool]$SkipFork
            skipE2E = [bool]$SkipE2E
            verifyLiveTestnet = [bool]$VerifyLiveTestnet
            mainnetMode = [bool]$MainnetMode
            mainnetEnvPathProvided = [bool]$MainnetEnvPath
        }
        selection = [ordered]@{
            forkExecuted = -not [bool]$SkipFork
            e2eExecuted = -not [bool]$SkipE2E
            liveTestnetAttestationsExecuted = [bool]$VerifyLiveTestnet
            liveMainnetAttestationsExecuted = [bool]$MainnetMode
            minimumCounts = $minimumCounts
        }
        broadcastPolicy = "forbidden"
        broadcastRequested = [bool]$broadcastRequested
        broadcastCapableSteps = [int]$broadcastCapableSteps
        broadcastPerformed = [bool]$broadcastPerformed
        secretsScrubbedBeforeChildProcesses = @($secretsScrubbed)
        skippedSteps = $skippedCount
        steps = $results
    }
    $resolvedReport = Join-Path $projectRoot $ReportPath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedReport) | Out-Null
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $reportJson = ($report | ConvertTo-Json -Depth 8).Replace("`r`n", "`n")
    [System.IO.File]::WriteAllText($resolvedReport, $reportJson, $utf8NoBom)
    Write-Host "Release gate report: $resolvedReport"
}

if ($failed) { exit 1 }
Write-Host "All selected release gates passed. No transaction was broadcast." -ForegroundColor Green
