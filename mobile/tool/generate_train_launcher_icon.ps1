Add-Type -AssemblyName System.Drawing

function New-RoundedPath([single]$x, [single]$y, [single]$width, [single]$height, [single]$radius) {
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $radius * 2
    $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
    $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

$source = [System.Drawing.Bitmap]::new(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($source)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)
$green = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(0, 122, 85))
$white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)

try {
    $background = New-RoundedPath 32 32 960 960 220
    $graphics.FillPath($green, $background)
    $background.Dispose()

    $leftFoot = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(365, 715),
        [System.Drawing.PointF]::new(430, 755),
        [System.Drawing.PointF]::new(339, 866),
        [System.Drawing.PointF]::new(275, 866)
    )
    $rightFoot = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(659, 715),
        [System.Drawing.PointF]::new(594, 755),
        [System.Drawing.PointF]::new(685, 866),
        [System.Drawing.PointF]::new(749, 866)
    )
    $graphics.FillPolygon($white, $leftFoot)
    $graphics.FillPolygon($white, $rightFoot)

    $body = New-RoundedPath 292 176 440 575 92
    $graphics.FillPath($white, $body)
    $body.Dispose()

    $window = New-RoundedPath 357 284 310 195 30
    $graphics.FillPath($green, $window)
    $window.Dispose()
    $graphics.FillEllipse($green, 363, 607, 70, 70)
    $graphics.FillEllipse($green, 591, 607, 70, 70)

    $sizes = @{
        'mipmap-mdpi' = 48
        'mipmap-hdpi' = 72
        'mipmap-xhdpi' = 96
        'mipmap-xxhdpi' = 144
        'mipmap-xxxhdpi' = 192
    }
    foreach ($entry in $sizes.GetEnumerator()) {
        $size = [int]$entry.Value
        $target = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $targetGraphics = [System.Drawing.Graphics]::FromImage($target)
        try {
            $targetGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $targetGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $targetGraphics.DrawImage($source, 0, 0, $size, $size)
            $path = Join-Path $PSScriptRoot "..\android\app\src\main\res\$($entry.Key)\ic_launcher.png"
            $target.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $targetGraphics.Dispose()
            $target.Dispose()
        }
    }
} finally {
    $green.Dispose()
    $white.Dispose()
    $graphics.Dispose()
    $source.Dispose()
}
