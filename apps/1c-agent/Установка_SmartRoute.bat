@echo off
chcp 65001 > nul 2>&1
setlocal EnableDelayedExpansion
title SmartRoute 1C Agent - Установка

echo.
echo  =============================================================
echo                 SmartRoute 1C Integration Agent
echo  =============================================================
echo.
echo  [1/3] Подготовка файлов и папки приложения...

set "SOURCE_DIR=%~dp0"
set "TARGET_DIR=%LOCALAPPDATA%\SmartRouteAgent"

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%" > nul 2>&1

:: Копирование файлов
if exist "%SOURCE_DIR%core" (
    xcopy /y /q "%SOURCE_DIR%core\*.*" "%TARGET_DIR%\" > nul 2>&1
)
xcopy /y /q "%SOURCE_DIR%*.*" "%TARGET_DIR%\" > nul 2>&1

echo  [2/3] Создание ярлыка с иконкой на Рабочем столе...

:: Создание ярлыка через PowerShell (работает на 100%% ПК без Python)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$target = Join-Path $env:LOCALAPPDATA 'SmartRouteAgent\SmartRoute_1C_Agent.hta'; " ^
  "$icon = Join-Path $env:LOCALAPPDATA 'SmartRouteAgent\smartroute.ico'; " ^
  "$sc = $ws.CreateShortcut((Join-Path $desktop 'SmartRoute 1C Agent.lnk')); " ^
  "$sc.TargetPath = 'mshta.exe'; " ^
  "$sc.Arguments = '\"' + $target + '\"'; " ^
  "$sc.WorkingDirectory = (Join-Path $env:LOCALAPPDATA 'SmartRouteAgent'); " ^
  "if (Test-Path $icon) { $sc.IconLocation = $icon + ',0' }; " ^
  "$sc.Description = 'SmartRoute 1C Integration Agent'; " ^
  "$sc.Save(); " ^
  "$startMenu = [Environment]::GetFolderPath('Programs'); " ^
  "$sc2 = $ws.CreateShortcut((Join-Path $startMenu 'SmartRoute 1C Agent.lnk')); " ^
  "$sc2.TargetPath = 'mshta.exe'; " ^
  "$sc2.Arguments = '\"' + $target + '\"'; " ^
  "$sc2.WorkingDirectory = (Join-Path $env:LOCALAPPDATA 'SmartRouteAgent'); " ^
  "if (Test-Path $icon) { $sc2.IconLocation = $icon + ',0' }; " ^
  "$sc2.Description = 'SmartRoute 1C Integration Agent'; " ^
  "$sc2.Save();" > nul 2>&1

echo  [3/3] Запуск приложения SmartRoute 1C Agent...

:: Запуск приложения
start "" mshta.exe "%TARGET_DIR%\SmartRoute_1C_Agent.hta"

echo.
echo  =============================================================
echo   УСПЕШНО УСТАНОВЛЕНО!
echo.
echo   * Ярлык с фирменной иконкой создан на Рабочем столе.
echo   * Окно SmartRoute 1C Agent уже открывается...
echo   * Выполните 3 шага в окне программы для подключения 1С.
echo  =============================================================
echo.
timeout /t 3 > nul
exit
