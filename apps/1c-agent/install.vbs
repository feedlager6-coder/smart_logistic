' SmartRoute 1C Agent - Windows 1-Click Installer
Option Explicit

Dim objFSO, objShell, strSourceDir, strAppDir, strDesktop, strPrograms, objShortcut, strIcon, strHtaPath
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

strSourceDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strAppDir = objShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\SmartRouteAgent"
strDesktop = objShell.SpecialFolders("Desktop")
strPrograms = objShell.SpecialFolders("Programs")

' Create destination directory
If Not objFSO.FolderExists(strAppDir) Then
    objFSO.CreateFolder(strAppDir)
End If

' Copy all files from source directory
If objFSO.FolderExists(strSourceDir & "\core") Then
    objFSO.CopyFile strSourceDir & "\core\*.*", strAppDir & "\", True
End If
objFSO.CopyFile strSourceDir & "\*.*", strAppDir & "\", True

strIcon = strAppDir & "\smartroute.ico"
If Not objFSO.FileExists(strIcon) Then
    strIcon = strSourceDir & "\smartroute.ico"
End If
If Not objFSO.FileExists(strIcon) Then
    strIcon = "shell32.dll,43"
End If

strHtaPath = strAppDir & "\SmartRoute_1C_Agent.hta"
If Not objFSO.FileExists(strHtaPath) Then
    strHtaPath = strSourceDir & "\SmartRoute_1C_Agent.hta"
End If

' Create Desktop shortcut
Set objShortcut = objShell.CreateShortcut(strDesktop & "\SmartRoute 1C Agent.lnk")
objShortcut.TargetPath = "mshta.exe"
objShortcut.Arguments = """" & strHtaPath & """"
objShortcut.WorkingDirectory = strAppDir
objShortcut.IconLocation = strIcon & ",0"
objShortcut.Description = "SmartRoute 1C Integration Agent"
objShortcut.Save

' Create Start Menu shortcut
Set objShortcut = objShell.CreateShortcut(strPrograms & "\SmartRoute 1C Agent.lnk")
objShortcut.TargetPath = "mshta.exe"
objShortcut.Arguments = """" & strHtaPath & """"
objShortcut.WorkingDirectory = strAppDir
objShortcut.IconLocation = strIcon & ",0"
objShortcut.Description = "SmartRoute 1C Integration Agent"
objShortcut.Save

' Launch HTA app immediately
objShell.Run "mshta.exe """ & strHtaPath & """", 1, False

WScript.Quit 0
