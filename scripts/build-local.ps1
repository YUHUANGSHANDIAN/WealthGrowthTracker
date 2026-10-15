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
        $tauriArgs = @('tauri', 'build', '--ci', '--config', 'src-tauri/tauri.desktop.conf.json')
        if ($NoBundle) { $tauriArgs += '--no-bundle' }
        npx @tauriArgs
        if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
} finally {
    Restore-WgtLocalEnvironment -State $state
}
