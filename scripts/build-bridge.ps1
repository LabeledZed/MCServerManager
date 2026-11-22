$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$pluginRoot = Join-Path $root "plugin"
$platformsRoot = Join-Path $pluginRoot "platforms"
$buildDir = Join-Path $pluginRoot "build"
$assetsDir = Join-Path $root "assets"
$jsonUtilSrc = Join-Path $pluginRoot "src\com\mcservermanager\bridge\JsonUtil.java"
$modCommonSrc = Join-Path $platformsRoot "mod-common\src\com\mcservermanager\bridge\mod\ReflectiveMinecraftServerBridge.java"

# Locate javac.exe (JAVA_HOME, PATH, or installed JDKs)
$javac = $null
if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\javac.exe"))) {
  $javac = Join-Path $env:JAVA_HOME "bin\javac.exe"
}
if (-not $javac) {
  $cmd = Get-Command javac.exe -ErrorAction SilentlyContinue
  if ($cmd) { $javac = $cmd.Source }
}
if (-not $javac) {
  $localJdkDir = Join-Path $root "jdk"
  if (Test-Path $localJdkDir) {
    $found = Get-ChildItem $localJdkDir -Filter "javac.exe" -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $javac = $found.FullName }
  }
}
if (-not $javac) {
  $found = Get-ChildItem "C:\Program Files","C:\Program Files (x86)" -Filter "javac.exe" -Recurse -Depth 4 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $javac = $found.FullName }
}
if (-not $javac) {
  Write-Error "No javac.exe JDK found to compile MCServerManagerBridge JARs"
  exit 1
}

function Add-ZipText([System.IO.Compression.ZipArchive]$archive, [string]$entryName, [string]$content) {
  $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
  $sw = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
  $sw.Write($content)
  $sw.Dispose()
}

function Add-ZipFile([System.IO.Compression.ZipArchive]$archive, [string]$entryName, [string]$filePath) {
  $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
  $inStream = [System.IO.File]::OpenRead($filePath)
  $outStream = $entry.Open()
  $inStream.CopyTo($outStream)
  $outStream.Dispose()
  $inStream.Dispose()
}

function Build-BridgeJar {
  param(
    [string]$Label,
    [string]$OutJarName,
    [string]$Release,
    [string[]]$StubFiles,
    [string[]]$SrcFiles,
    [string]$ResourcesDir
  )

  $work = Join-Path $buildDir $Label
  $stubsOut = Join-Path $work "stubs"
  $classesOut = Join-Path $work "classes"
  New-Item -ItemType Directory -Force -Path $stubsOut, $classesOut | Out-Null

  Write-Host "Compiling $OutJarName ($Label, --release $Release)..."
  if ($StubFiles.Count -gt 0) {
    & $javac --release $Release -Xlint:-options -d $stubsOut @StubFiles
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $javac --release $Release -Xlint:-options -cp $stubsOut -d $classesOut @SrcFiles
  } else {
    & $javac --release $Release -Xlint:-options -d $classesOut @SrcFiles
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $outJar = Join-Path $assetsDir $OutJarName
  if (Test-Path $outJar) { Remove-Item -Force $outJar }
  $fs = [System.IO.File]::Open($outJar, [System.IO.FileMode]::Create)
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)

  Add-ZipText $zip "META-INF/MANIFEST.MF" "Manifest-Version: 1.0`r`nCreated-By: MCServerManager`r`n`r`n"

  if ($ResourcesDir -and (Test-Path $ResourcesDir)) {
    $resFiles = Get-ChildItem $ResourcesDir -File -Recurse
    foreach ($rf in $resFiles) {
      $rel = $rf.FullName.Substring($ResourcesDir.Length + 1).Replace('\', '/')
      Add-ZipFile $zip $rel $rf.FullName
    }
  }

  $classFiles = Get-ChildItem $classesOut -Filter "*.class" -Recurse
  foreach ($cf in $classFiles) {
    $rel = $cf.FullName.Substring($classesOut.Length + 1).Replace('\', '/')
    Add-ZipFile $zip $rel $cf.FullName
  }

  $zip.Dispose()
  $fs.Dispose()
  Write-Host "  Built $outJar ($((Get-Item $outJar).Length) bytes)"
}

Write-Host "Building all MCServerManagerBridge platform JARs using $javac..."
if (Test-Path $buildDir) { Remove-Item -Recurse -Force $buildDir }
New-Item -ItemType Directory -Force -Path $buildDir, $assetsDir | Out-Null

# 1. Spigot / Paper / Purpur / Leaf / Folia / Custom
Build-BridgeJar `
  -Label "spigot-folia" `
  -OutJarName "MCServerManagerBridge.jar" `
  -Release "8" `
  -StubFiles @(Get-ChildItem (Join-Path $pluginRoot "stubs") -Filter "*.java" -Recurse | ForEach-Object { $_.FullName }) `
  -SrcFiles @(Get-ChildItem (Join-Path $pluginRoot "src") -Filter "*.java" -Recurse | ForEach-Object { $_.FullName }) `
  -ResourcesDir (Join-Path $pluginRoot "resources")

# 2. Velocity Proxy
$velDir = Join-Path $platformsRoot "velocity"
Build-BridgeJar `
  -Label "velocity" `
  -OutJarName "MCServerManagerBridge-Velocity.jar" `
  -Release "17" `
  -StubFiles @(Get-ChildItem (Join-Path $velDir "stubs") -Filter "*.java" -Recurse | ForEach-Object { $_.FullName }) `
  -SrcFiles (@($jsonUtilSrc) + @(Get-ChildItem (Join-Path $velDir "src") -Filter "*.java" -Recurse | ForEach-Object { $_.FullName })) `
  -ResourcesDir (Join-Path $velDir "resources")

# 3. Fabric Mod
$fabDir = Join-Path $platformsRoot "fabric"
Build-BridgeJar `
  -Label "fabric" `
  -OutJarName "MCServerManagerBridge-Fabric.jar" `
  -Release "17" `
  -StubFiles @(Get-ChildItem (Join-Path $fabDir "stubs") -Filter "*.java" -Recurse | ForEach-Object { $_.FullName }) `
  -SrcFiles (@($jsonUtilSrc, $modCommonSrc) + @(Get-ChildItem (Join-Path $fabDir "src") -Filter "*.java" -Recurse | ForEach-Object { $_.FullName })) `
  -ResourcesDir (Join-Path $fabDir "resources")

# 4. NeoForge Mod
$neoDir = Join-Path $platformsRoot "neoforge"
Build-BridgeJar `
  -Label "neoforge" `
  -OutJarName "MCServerManagerBridge-NeoForge.jar" `
  -Release "17" `
  -StubFiles @(Get-ChildItem (Join-Path $neoDir "stubs") -Filter "*.java" -Recurse | ForEach-Object { $_.FullName }) `
  -SrcFiles (@($jsonUtilSrc, $modCommonSrc) + @(Get-ChildItem (Join-Path $neoDir "src") -Filter "*.java" -Recurse | ForEach-Object { $_.FullName })) `
  -ResourcesDir (Join-Path $neoDir "resources")

# 5. Forge Mod
$forgeDir = Join-Path $platformsRoot "forge"
Build-BridgeJar `
  -Label "forge" `
  -OutJarName "MCServerManagerBridge-Forge.jar" `
  -Release "17" `
  -StubFiles @(Get-ChildItem (Join-Path $forgeDir "stubs") -Filter "*.java" -Recurse | ForEach-Object { $_.FullName }) `
  -SrcFiles (@($jsonUtilSrc, $modCommonSrc) + @(Get-ChildItem (Join-Path $forgeDir "src") -Filter "*.java" -Recurse | ForEach-Object { $_.FullName })) `
  -ResourcesDir (Join-Path $forgeDir "resources")

Remove-Item -Recurse -Force $buildDir
Write-Host "All 5 MCServerManagerBridge platform JARs built successfully."
