; Custom NSIS include (picked up by electron-builder from build/installer.nsh).
; Downgrade guard: refuse to install over a NEWER installed version, so an old installer
; kept in Downloads cannot silently take the user backwards. Same or newer versions
; (including the auto-updater, which always installs a newer one) pass.
!include "WordFunc.nsh"
!insertmacro VersionCompare

!macro customInit
  ReadRegStr $R0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${If} $R0 != ""
    ${VersionCompare} "$R0" "${VERSION}" $R1
    ; $R1: 0 = equal, 1 = installed is newer, 2 = installed is older
    ${If} $R1 == 1
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "A newer version of TTT Sub ($R0) is already installed.$\r$\nThis installer is the older version ${VERSION}, so it will not run.$\r$\nDelete this old installer file."
      ${EndIf}
      Quit
    ${EndIf}
  ${EndIf}
!macroend
