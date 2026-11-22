# Generates a crisp multi-resolution 2-color Windows .ico (#1a1a1a and #37abc8) matching assets/icon.svg
Add-Type -AssemblyName System.Drawing

$bgColor = [System.Drawing.Color]::FromArgb(255, 0x1a, 0x1a, 0x1a)
$fgColor = [System.Drawing.Color]::FromArgb(255, 0x37, 0xab, 0xc8)

function New-IconPngBytes([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = [float]$size / 64.0
  $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
  $fgBrush = New-Object System.Drawing.SolidBrush($fgColor)

  # Rounded square background (#1a1a1a)
  $r = 13.0 * $s
  $d = $r * 2.0
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath($bgBrush, $path)
  $path.Dispose()

  function Pt([float]$x, [float]$y) {
    return New-Object System.Drawing.PointF(($x * $s), ($y * $s))
  }

  # Top face (#37abc8)
  $topPts = [System.Drawing.PointF[]]@( (Pt 32 8), (Pt 54 19), (Pt 32 30), (Pt 10 19) )
  $g.FillPolygon($fgBrush, $topPts)

  # Left face (#37abc8) + 2 server rack cutouts (#1a1a1a)
  $leftPts = [System.Drawing.PointF[]]@( (Pt 10 23.5), (Pt 30 33.5), (Pt 30 55.5), (Pt 10 45.5) )
  $g.FillPolygon($fgBrush, $leftPts)
  if ($size -ge 24) {
    $cut1 = [System.Drawing.PointF[]]@( (Pt 14 30), (Pt 26 36), (Pt 26 40), (Pt 14 34) )
    $cut2 = [System.Drawing.PointF[]]@( (Pt 14 39), (Pt 26 45), (Pt 26 49), (Pt 14 43) )
    $g.FillPolygon($bgBrush, $cut1)
    $g.FillPolygon($bgBrush, $cut2)
  }

  # Right face (#37abc8) + terminal chevron cutout (#1a1a1a)
  $rightPts = [System.Drawing.PointF[]]@( (Pt 54 23.5), (Pt 34 33.5), (Pt 34 55.5), (Pt 54 45.5) )
  $g.FillPolygon($fgBrush, $rightPts)
  if ($size -ge 24) {
    $cutR = [System.Drawing.PointF[]]@( (Pt 39 34), (Pt 49 35.5), (Pt 49 39.5), (Pt 39 49), (Pt 39 44.2), (Pt 44.2 38.8), (Pt 39 38) )
    $g.FillPolygon($bgBrush, $cutR)
  }

  $bgBrush.Dispose()
  $fgBrush.Dispose()
  $g.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $ms.Dispose()
  $bmp.Dispose()
  return ,$bytes
}

$sizes = @(16, 32, 48, 256)
$frames = @()
foreach ($sz in $sizes) {
  $frames += ,@{ Size = $sz; Bytes = (New-IconPngBytes $sz) }
}

$icoStream = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($icoStream)

# ICONDIR header
$bw.Write([UInt16]0)            # Reserved
$bw.Write([UInt16]1)            # Type = ICO
$bw.Write([UInt16]$frames.Count)

$offset = 6 + (16 * $frames.Count)
foreach ($f in $frames) {
  $dim = if ($f.Size -ge 256) { [byte]0 } else { [byte]$f.Size }
  $bw.Write($dim)               # Width
  $bw.Write($dim)               # Height
  $bw.Write([byte]0)            # Color count
  $bw.Write([byte]0)            # Reserved
  $bw.Write([UInt16]1)          # Planes
  $bw.Write([UInt16]32)         # Bit count
  $bw.Write([UInt32]$f.Bytes.Length)
  $bw.Write([UInt32]$offset)
  $offset += $f.Bytes.Length
}

foreach ($f in $frames) {
  $bw.Write($f.Bytes)
}

$icoBytes = $icoStream.ToArray()
$bw.Dispose()
$icoStream.Dispose()

$root = Split-Path -Parent $PSScriptRoot
[System.IO.File]::WriteAllBytes((Join-Path $root "assets\icon.ico"), $icoBytes)
[System.IO.File]::WriteAllBytes((Join-Path $root "client\public\favicon.ico"), $icoBytes)
# Also save a 256px PNG preview in assets/icon.png for inspection/shortcuts
[System.IO.File]::WriteAllBytes((Join-Path $root "assets\icon.png"), $frames[-1].Bytes)
Write-Host "Generated assets\icon.ico, client\public\favicon.ico, and assets\icon.png ($($icoBytes.Length) bytes)"
