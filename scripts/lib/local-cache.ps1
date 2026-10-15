# Shared helpers: resolve the external cache root and prepare an isolated build
# environment for child processes.
#
# Design rules:
#  - The public repository never stores a personal absolute path.
#  - Machine-specific paths live in the git-ignored <repo>\.wgt-local.json or in
#    the WGT_CACHE_ROOT environment variable.
#  - Only the current process and its children are modified; setx is never used.
#  - This file is intentionally ASCII-only so Windows PowerShell 5.1 and
#    PowerShell 7 both parse it regardless of the console code page.

function Resolve-WgtLocalPath {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [string]$Explicit
    )
    if ($Explicit) { return $Explicit }
    if ($env:WGT_CACHE_ROOT) { return $env:WGT_CACHE_ROOT }
    $localFile = Join-Path $RepoRoot '.wgt-local.json'
    if (Test-Path -LiteralPath $localFile) {
        try {
            $config = Get-Content -LiteralPath $localFile -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            throw "Cannot parse $localFile : $($_.Exception.Message)"
        }
        if ($config.cacheRoot) { return [string]$config.cacheRoot }
    }
    return (Join-Path $env:LOCALAPPDATA 'WealthGrowthTrackerCache')
}

function Assert-WgtCacheRoot {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$CacheRoot
    )
    if (-not [System.IO.Path]::IsPathRooted($CacheRoot)) {
        throw "Cache root must be an absolute path: $CacheRoot"
    }
    $full = [System.IO.Path]::GetFullPath($CacheRoot).TrimEnd('\')
    $repo = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')
    if ($full -eq $repo) { throw 'Cache root must not equal the repository root (that would keep the bloat).' }
    if ($full.StartsWith($repo + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Cache root must not live inside the repository: $full"
    }
    return $full
}

function New-WgtLocalEnvironment {
    param(
        [Parameter(Mandatory)][string]$CacheRoot,
        [Parameter(Mandatory)][string]$SessionName
    )
    $cargoDir = Join-Path $CacheRoot 'cargo'
    $tempDir = Join-Path $CacheRoot ('temp\' + $SessionName + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID)
    New-Item -ItemType Directory -Force -Path $cargoDir, $tempDir | Out-Null
    $names = @('CARGO_TARGET_DIR', 'TEMP', 'TMP', 'WGT_CACHE_ROOT')
    $saved = @{}
    foreach ($name in $names) {
        $saved[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $env:CARGO_TARGET_DIR = $cargoDir
    $env:TEMP = $tempDir
    $env:TMP = $tempDir
    $env:WGT_CACHE_ROOT = $CacheRoot
    return [pscustomobject]@{
        CargoDir = $cargoDir
        TempDir  = $tempDir
        Saved    = $saved
        Names    = $names
    }
}

function Restore-WgtLocalEnvironment {
    param([Parameter(Mandatory)]$State)
    foreach ($name in $State.Names) {
        # $null restores the "was not set" state instead of leaving it empty.
        [System.Environment]::SetEnvironmentVariable($name, $State.Saved[$name], 'Process')
    }
}

function Write-WgtLocalBanner {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$CacheRoot,
        [Parameter(Mandatory)]$State
    )
    Write-Host "Repository        : $RepoRoot"
    Write-Host "External cache    : $CacheRoot"
    Write-Host "CARGO_TARGET_DIR  : $($State.CargoDir)"
    Write-Host "Session TEMP/TMP  : $($State.TempDir)"
    Write-Host "User-level environment variables are untouched; this process is restored on exit."
}
