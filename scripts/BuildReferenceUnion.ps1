param()

$ErrorActionPreference = 'Stop'

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$referenceRoot = Join-Path $workspace 'FWA_ETHEREUM_REFERENCE'
$target = [System.IO.Path]::GetFullPath((Join-Path $workspace 'vendor\fwa-reference-union'))
$expectedPrefix = $workspace.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

if (-not $target.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside workspace: $target"
}

$sourceRoots = Get-ChildItem -LiteralPath $referenceRoot -Directory |
    ForEach-Object { Join-Path $_.FullName 'sources' } |
    Where-Object { Test-Path -LiteralPath $_ }

$entries = @{}
foreach ($sourceRoot in $sourceRoots) {
    Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($sourceRoot.Length + 1)
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        if ($entries.ContainsKey($relative)) {
            if ($entries[$relative].Hash -ne $hash) {
                throw "Conflicting verified source for $relative"
            }
        } else {
            $entries[$relative] = [pscustomobject]@{ Source = $_.FullName; Hash = $hash }
        }
    }
}

if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
}
New-Item -ItemType Directory -Path $target | Out-Null

foreach ($relative in $entries.Keys) {
    $destination = Join-Path $target $relative
    $destinationDirectory = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $destinationDirectory)) {
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }
    Copy-Item -LiteralPath $entries[$relative].Source -Destination $destination
}

[pscustomobject]@{
    SourceBundles = $sourceRoots.Count
    UniqueFiles = $entries.Count
    Target = $target
}
