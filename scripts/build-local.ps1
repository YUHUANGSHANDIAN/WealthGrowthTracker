#Requires -Version 5.1
<#
.SYNOPSIS
    Local desktop build entry point. Puts the Cargo target directory and the
    build scratch directory outside the repository so the checkout cannot grow
    again after a cleanup.

.EXAMPLE
    ./scripts/build-local.ps1
    ./scripts/build-local.ps1 -NoBundle
    ./scripts/build-local.ps1 -CacheRoot <absolute-cache-root>
#>
[CmdletBinding()]
param(
    [string]$CacheRoot,
    [switch]$NoBundle,
    [switch]$SkipSidecar,
    [switch]$SkipRuntimeResources
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib\local-cache.ps1')

$cache = Assert-WgtCacheRoot -RepoRoot $repoRoot -CacheRoot (Resolve-WgtLocalPath -RepoRoot $repoRoot -Explicit $CacheRoot)
$state = New-WgtLocalEnvironment -CacheRoot $cache -SessionName 'build'
Write-WgtLocalBanner -RepoRoot $repoRoot -CacheRoot $cache -State $state

try {
    Push-Location $repoRoot
    try {
        if (-not $SkipSidecar) {
            node scripts/fetch-node-sidecar.mjs
            if ($LASTEXITCODE -ne 0) { throw "fetch-node-sidecar failed with exit code $LASTEXITCODE" }
        }
        if (-not $SkipRuntimeResources) {
            node scripts/prepare-ai-runtime-resources.mjs
            if ($LASTEXITCODE -ne 0) { throw "prepare-ai-runtime-resources failed with exit code $LASTEXITCODE" }
        }

        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }

        # Vite writes to the external cache. Tauri embeds the stable repository
        # frontendDist path, so mirror the completed output without deleting the
        # generated directory. Old hashed assets may remain but are not referenced.
        $frontendTarget = Join-Path $repoRoot 'dist'
        New-Item -ItemType Directory -Path $frontendTarget -Force | Out-Null
        Copy-Item -Path (Join-Path $state.FrontendDir '*') -Destination $frontendTarget -Recurse -Force
        if (-not (Test-Path -LiteralPath (Join-Path $frontendTarget 'index.html'))) {
            throw "frontend output was not mirrored to $frontendTarget"
        }

        $tauriOverride = @{
            build = @{
                beforeBuildCommand = ''
            }
        } | ConvertTo-Json -Compress -Depth 4
        $tauriArgs = @(
            'tauri', 'build', '--ci',
            '--config', 'src-tauri/tauri.desktop.conf.json',
            '--config', $tauriOverride
        )
        if ($NoBundle) { $tauriArgs += '--no-bundle' }
        elseif ($env:OS -eq 'Windows_NT') {
            $tauriArgs += @('--bundles', 'nsis')
        }
        npx @tauriArgs
        if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
} finally {
    Restore-WgtLocalEnvironment -State $state
}
