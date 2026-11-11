#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CandidateInstaller,
    [string]$LegacyVersion = 'v1.10.0-preview.1'
)

$ErrorActionPreference = 'Stop'
$repo = 'YUHUANGSHANDIAN/WealthGrowthTracker'
$candidate = (Resolve-Path -LiteralPath $CandidateInstaller).Path
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("wgt-upgrade-smoke-{0}-{1}" -f $PID, (Get-Date -Format 'yyyyMMddHHmmss'))
$legacyDir = Join-Path $work 'legacy-installer'
$syntheticRoot = Join-Path $work 'WealthData'
New-Item -ItemType Directory -Path $legacyDir, $syntheticRoot -Force | Out-Null

gh release download $LegacyVersion --repo $repo --pattern '*x64-setup.exe' --dir $legacyDir
$legacyInstaller = Get-ChildItem -LiteralPath $legacyDir -Filter '*.exe' | Select-Object -First 1
if (-not $legacyInstaller) { throw "未下载到旧版安装器" }

$release = gh release view $LegacyVersion --repo $repo --json assets | ConvertFrom-Json
$legacyAsset = $release.assets | Where-Object name -eq $legacyInstaller.Name | Select-Object -First 1
if (-not $legacyAsset -or -not $legacyAsset.digest) { throw "旧版 Release 缺少 SHA-256 digest" }
$actualLegacyHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $legacyInstaller.FullName).Hash.ToLowerInvariant()
$expectedLegacyHash = ([string]$legacyAsset.digest).Replace('sha256:', '')
if ($actualLegacyHash -ne $expectedLegacyHash) { throw "旧版安装器 SHA-256 不匹配" }

$configDir = Join-Path $env:APPDATA 'com.yuhuangshandian.wealthgrowthtracker'
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$config = [ordered]@{
    dataRootMode = 'custom'
    customDataRoot = $syntheticRoot
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $configDir 'storage-config.json') -Encoding utf8
'synthetic-upgrade-marker' | Set-Content -LiteralPath (Join-Path $syntheticRoot 'marker.txt') -Encoding utf8
$dataHashBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $syntheticRoot 'marker.txt')).Hash

$legacyProcess = Start-Process -FilePath $legacyInstaller.FullName -ArgumentList '/S' -PassThru -Wait
if ($legacyProcess.ExitCode -ne 0) { throw "旧版安装失败：$($legacyProcess.ExitCode)" }

$candidateProcess = Start-Process -FilePath $candidate -ArgumentList '/S' -PassThru -Wait
if ($candidateProcess.ExitCode -ne 0) { throw "候选版覆盖安装失败：$($candidateProcess.ExitCode)" }

$uninstall = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WealthGrowthTracker'
if ($uninstall.DisplayName -ne 'WealthGrowthTracker') { throw "卸载项名称不正确" }
$installLocation = ([string]$uninstall.InstallLocation).Trim('"')
$newExe = Join-Path $installLocation 'WealthGrowthTracker.exe'
$legacyExe = Join-Path $installLocation 'wealth-growth-tracker.exe'
if (-not (Test-Path -LiteralPath $newExe)) { throw "未生成 WealthGrowthTracker.exe" }
if (Test-Path -LiteralPath $legacyExe) { throw "升级后仍残留旧主程序" }
foreach ($runtimePath in @('node.exe', 'ai-runtime\main.mjs')) {
    if (-not (Test-Path -LiteralPath (Join-Path $installLocation $runtimePath))) {
        throw "安装资源缺失：$runtimePath"
    }
}

$wsh = New-Object -ComObject WScript.Shell
$shortcutCandidates = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'WealthGrowthTracker.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\WealthGrowthTracker.lnk')
)
foreach ($shortcutPath in $shortcutCandidates) {
    if (Test-Path -LiteralPath $shortcutPath) {
        $shortcut = $wsh.CreateShortcut($shortcutPath)
        if ($shortcut.TargetPath -ne $newExe) { throw "快捷方式仍指向错误目标：$shortcutPath" }
    }
}

$versionInfo = (Get-Item -LiteralPath $newExe).VersionInfo
if ($versionInfo.ProductName -ne 'WealthGrowthTracker') { throw "ProductName 不正确" }
if ($versionInfo.FileDescription -ne 'WealthGrowthTracker') { throw "FileDescription 不正确" }

$app = Start-Process -FilePath $newExe -ArgumentList '--ai-plugin-selftest' -PassThru
if (-not $app.WaitForExit(30000)) {
    Stop-Process -Id $app.Id -Force
    throw "应用自检未在 30 秒内结束"
}
if ($app.ExitCode -ne 0) { throw "应用 AI Runtime 自检失败：$($app.ExitCode)" }

$dataHashAfter = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $syntheticRoot 'marker.txt')).Hash
if ($dataHashBefore -ne $dataHashAfter) { throw "覆盖安装改变了合成数据" }

$uninstaller = Join-Path $installLocation 'uninstall.exe'
$uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -Wait
if ($uninstallProcess.ExitCode -ne 0) { throw "卸载失败：$($uninstallProcess.ExitCode)" }
for ($attempt = 0; $attempt -lt 15; $attempt++) {
    if (-not (Test-Path -LiteralPath $newExe) -and -not (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WealthGrowthTracker' -ErrorAction SilentlyContinue)) {
        break
    }
    Start-Sleep -Seconds 1
}
if (Test-Path -LiteralPath $newExe) { throw "卸载后仍残留 WealthGrowthTracker.exe" }
if (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WealthGrowthTracker' -ErrorAction SilentlyContinue) {
    throw "卸载后仍残留 HKCU 卸载项"
}
$dataHashAfterUninstall = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $syntheticRoot 'marker.txt')).Hash
if ($dataHashBefore -ne $dataHashAfterUninstall) { throw "卸载改变了合成数据根" }

[pscustomobject]@{
    legacyVersion = $LegacyVersion
    candidate = $candidate
    installLocation = $installLocation
    mainExecutable = $newExe
    productVersion = $versionInfo.ProductVersion
    signature = (Get-AuthenticodeSignature -LiteralPath $candidate).Status.ToString()
    syntheticDataUnchanged = $dataHashBefore -eq $dataHashAfter
    uninstallPreservedData = $dataHashBefore -eq $dataHashAfterUninstall
} | ConvertTo-Json -Compress
