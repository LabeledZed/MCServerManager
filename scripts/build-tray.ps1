$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $csc)) {
  Write-Error "C# compiler not found at $csc"
  exit 1
}

$ico = Join-Path $root "assets\icon.ico"
if (-not (Test-Path $ico)) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\generate-icon.ps1")
}

$src = Join-Path $root "tray\MCServerManagerTray.cs"
$outExe = Join-Path $root "MCServerManager.exe"

& $csc /nologo /target:winexe /optimize+ `
  /win32icon:"$ico" `
  /out:"$outExe" `
  /r:System.dll `
  /r:System.Drawing.dll `
  /r:System.Windows.Forms.dll `
  /r:System.Web.Extensions.dll `
  "$src"

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "Built $outExe successfully."
