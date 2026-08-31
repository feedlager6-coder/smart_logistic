!define PRODUCT_NAME "SmartRoute 1C Agent"
!define PRODUCT_VERSION "3.2.0"
!define PRODUCT_PUBLISHER "SmartRoute Logistics"
!define PRODUCT_WEB_SITE "https://smartroute.app"
!define PRODUCT_EXE "SmartRoute_Agent.exe"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SmartRoute1CAgent"

Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "MUI2.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON "smartroute.ico"
!define MUI_UNICON "smartroute.ico"

!define MUI_WELCOMEPAGE_TITLE "Установка SmartRoute 1C Agent"
!define MUI_WELCOMEPAGE_TEXT "Программа установит агент интеграции SmartRoute для 1С:Предприятие 8.3 / 8.2 на ваш компьютер.\r\n\r\nPython или другие компоненты не требуются.\r\n\r\nНажмите «Далее» для продолжения."
!insertmacro MUI_PAGE_WELCOME

!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить SmartRoute 1C Agent сейчас"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Создан ярлык на Рабочем столе"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Russian"

Name "${PRODUCT_NAME}"
OutFile "SmartRoute_1C_Agent_Setup.exe"
InstallDir "$LOCALAPPDATA\SmartRouteAgent"
ShowInstDetails show
ShowUnInstDetails show

Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  SetOverwrite ifnewer

  File "SmartRoute_Agent.exe"
  File "smartroute.ico"
  ; Never overwrite a user's token and settings during an update/reinstall.
  SetOverwrite off
  File "config.json"
  SetOverwrite ifnewer
  File "ИНСТРУКЦИЯ.txt"

  ; Create Desktop Shortcut
  CreateShortCut "$DESKTOP\SmartRoute 1C Agent.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\smartroute.ico" 0 SW_SHOWNORMAL "" "SmartRoute 1C Integration Agent"

  ; Create Start Menu Shortcut
  CreateDirectory "$SMPROGRAMS\SmartRoute"
  CreateShortCut "$SMPROGRAMS\SmartRoute\SmartRoute 1C Agent.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\smartroute.ico" 0 SW_SHOWNORMAL "" "SmartRoute 1C Integration Agent"
  CreateShortCut "$SMPROGRAMS\SmartRoute\Удалить SmartRoute 1C Agent.lnk" "$INSTDIR\uninst.exe" "" "$INSTDIR\uninst.exe" 0

  ; Registry uninstall entry
  WriteUninstaller "$INSTDIR\uninst.exe"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayName" "$(^Name)"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\uninst.exe"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\smartroute.ico"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
SectionEnd

Section Uninstall
  Delete "$DESKTOP\SmartRoute 1C Agent.lnk"
  Delete "$SMPROGRAMS\SmartRoute\SmartRoute 1C Agent.lnk"
  Delete "$SMPROGRAMS\SmartRoute\Удалить SmartRoute 1C Agent.lnk"
  RMDir "$SMPROGRAMS\SmartRoute"

  Delete "$INSTDIR\SmartRoute_Agent.exe"
  Delete "$INSTDIR\smartroute.ico"
  Delete "$INSTDIR\config.json"
  Delete "$INSTDIR\ИНСТРУКЦИЯ.txt"
  Delete "$INSTDIR\uninst.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${PRODUCT_UNINST_KEY}"
SectionEnd
