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

$script:RetiredWgtRoots = @(
    'D:\Dev',
    'D:\DevCache'
)

function Assert-WgtPathIsNotRetired {
    param([Parameter(Mandatory)][string]$Path)

    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        throw "Path must be absolute: $Path"
    }
    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    foreach ($retired in $script:RetiredWgtRoots) {
        if (
            $full.Equals($retired, [System.StringComparison]::OrdinalIgnoreCase) -or
            $full.StartsWith($retired + '\', [System.StringComparison]::OrdinalIgnoreCase)
        ) {
            throw "Refusing retired project root '$retired'. Use the approved Dev/DevCache roots."
        }
    }
    return $full
}

function Resolve-WgtLocalPath {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [string]$Explicit
    )
    if ($Explicit) { return Assert-WgtPathIsNotRetired -Path $Explicit }
    if ($env:WGT_CACHE_ROOT) { return Assert-WgtPathIsNotRetired -Path $env:WGT_CACHE_ROOT }
    $localFile = Join-Path $RepoRoot '.wgt-local.json'
    if (Test-Path -LiteralPath $localFile) {
        try {
            $config = Get-Content -LiteralPath $localFile -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            throw "Cannot parse $localFile : $($_.Exception.Message)"
        }
        if ($config.cacheRoot) {
            return Assert-WgtPathIsNotRetired -Path ([string]$config.cacheRoot)
        }
    }
    return (Join-Path $env:LOCALAPPDATA 'WealthGrowthTrackerCache')
}

function Assert-WgtCacheRoot {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$CacheRoot
    )
    $full = Assert-WgtPathIsNotRetired -Path $CacheRoot
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
    $frontendDir = Join-Path $CacheRoot 'frontend'
    $tempDir = Join-Path $CacheRoot ('temp\' + $SessionName + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID)
    New-Item -ItemType Directory -Force -Path $cargoDir, $tempDir | Out-Null
    $names = @('CARGO_TARGET_DIR', 'TEMP', 'TMP', 'WGT_CACHE_ROOT', 'WGT_FRONTEND_DIST', 'WGT_BUILD_ID', 'WGT_BUILD_COMMIT', 'WGT_BUILD_TIME')
    $saved = @{}
    foreach ($name in $names) {
        $saved[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $env:CARGO_TARGET_DIR = $cargoDir
    $env:TEMP = $tempDir
    $env:TMP = $tempDir
    $env:WGT_CACHE_ROOT = $CacheRoot
    $env:WGT_FRONTEND_DIST = $frontendDir
    try {
        $buildCommit = (& git -C $RepoRoot rev-parse --short=12 HEAD 2>$null).Trim()
        $dirty = -not [string]::IsNullOrWhiteSpace((& git -C $RepoRoot status --porcelain=v1 --untracked-files=no 2>$null))
        $env:WGT_BUILD_COMMIT = $buildCommit
        $env:WGT_BUILD_ID = "$buildCommit$(if ($dirty) { '-dirty' } else { '' })-$SessionName"
        $env:WGT_BUILD_TIME = (Get-Date).ToUniversalTime().ToString('o')
    } catch {
        $env:WGT_BUILD_COMMIT = 'unknown'
        $env:WGT_BUILD_ID = "unknown-$SessionName"
        $env:WGT_BUILD_TIME = (Get-Date).ToUniversalTime().ToString('o')
    }
    return [pscustomobject]@{
        CargoDir = $cargoDir
        FrontendDir = $frontendDir
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
    Write-Host "Frontend output   : $($State.FrontendDir)"
    Write-Host "Session TEMP/TMP  : $($State.TempDir)"
    Write-Host "User-level environment variables are untouched; this process is restored on exit."
}
