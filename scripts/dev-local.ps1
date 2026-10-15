#Requires -Version 5.1
<#
.SYNOPSIS
    Local development entry point. Uses the same external cache root as
    build-local.ps1 so a later "tauri dev" in the same shell keeps its target
    directory outside the repository.
#>
[CmdletBinding()]
param(
    [string]$CacheRoot,
    [int]$Port = 5173
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib\local-cache.ps1')

$cache = Assert-WgtCacheRoot -RepoRoot $repoRoot -CacheRoot (Resolve-WgtLocalPath -RepoRoot $repoRoot -Explicit $CacheRoot)
$state = New-WgtLocalEnvironment -CacheRoot $cache -SessionName 'dev'
Write-WgtLocalBanner -RepoRoot $repoRoot -CacheRoot $cache -State $state

try {
    Push-Location $repoRoot
    try {
        npm run dev -- --port $Port
        if ($LASTEXITCODE -ne 0) { throw "npm run dev failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
} finally {
    Restore-WgtLocalEnvironment -State $state
}
