#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib\local-cache.ps1')

function Assert-ThrowsContaining {
    param(
        [Parameter(Mandatory)][scriptblock]$Action,
        [Parameter(Mandatory)][string]$Expected
    )
    try {
        & $Action | Out-Null
    } catch {
        if ($_.Exception.Message -notlike "*$Expected*") {
            throw "Expected error containing '$Expected', got '$($_.Exception.Message)'"
        }
        return
    }
    throw "Expected action to fail with '$Expected'"
}

$resolved = Resolve-WgtLocalPath -RepoRoot $repoRoot
if (-not [System.IO.Path]::IsPathRooted($resolved)) {
    throw "Resolved cache root is not absolute: $resolved"
}

foreach ($retired in @('D:\Dev', 'D:\Dev\WealthGrowthTracker')) {
    Assert-ThrowsContaining { Resolve-WgtLocalPath -RepoRoot $repoRoot -Explicit $retired } 'retired'
}
foreach ($retired in @('D:\DevCache', 'D:\DevCache\wealth-growth-tracker')) {
    Assert-ThrowsContaining { Resolve-WgtLocalPath -RepoRoot $repoRoot -Explicit $retired } 'retired'
}
Assert-ThrowsContaining {
    Assert-WgtCacheRoot -RepoRoot $repoRoot -CacheRoot (Join-Path $repoRoot 'cache')
} 'inside the repository'

$valid = Assert-WgtCacheRoot -RepoRoot $repoRoot -CacheRoot $resolved
Write-Host "Local cache guards passed: $valid"
