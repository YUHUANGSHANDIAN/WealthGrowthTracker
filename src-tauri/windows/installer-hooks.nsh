; Compatibility cleanup for the pre-mainBinaryName Windows executable.
; Only the exact live legacy filename is touched. User-created backups such as
; wealth-growth-tracker.exe.before-diag-backup are intentionally preserved.

!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$INSTDIR\wealth-growth-tracker.exe"
    Delete "$INSTDIR\wealth-growth-tracker.exe"
  ${EndIf}

  ${If} ${FileExists} "$INSTDIR\wealth-growth-tracker.exe"
    MessageBox MB_ICONSTOP "无法清理旧版 WealthGrowthTracker.exe。请关闭正在运行的旧程序后重试安装。"
    SetErrorLevel 2
    Quit
  ${EndIf}

  ; Repair only shortcuts that already existed, keeping user deletion choices.
  IfFileExists "$DESKTOP\WealthGrowthTracker.lnk" 0 +2
    CreateShortCut "$DESKTOP\WealthGrowthTracker.lnk" "$INSTDIR\WealthGrowthTracker.exe" "" "$INSTDIR\WealthGrowthTracker.exe" 0
  IfFileExists "$SMPROGRAMS\WealthGrowthTracker.lnk" 0 +2
    CreateShortCut "$SMPROGRAMS\WealthGrowthTracker.lnk" "$INSTDIR\WealthGrowthTracker.exe" "" "$INSTDIR\WealthGrowthTracker.exe" 0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\wealth-growth-tracker.exe"
!macroend
