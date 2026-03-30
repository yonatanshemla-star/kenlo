Add-Type -AssemblyName System.Drawing

$sourcePath = "C:\Users\Yonatan\.gemini\antigravity\brain\6f497cd1-9d8e-4866-a9d4-4ff10e0a5ec4\media__1774857208704.jpg"
$targetPath = "C:\Users\Yonatan\.gemini\antigravity\scratch\movie-ranker\icon.png"

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
$newImage = New-Object System.Drawing.Bitmap $sourceImage
$graphics = [System.Drawing.Graphics]::FromImage($newImage)

$w = $newImage.Width
$h = $newImage.Height

# The Gemini watermark is always bottom right.
# We sample the color just outside the watermark bounds (e.g., 120px left, 80px up from corner).
$sampleColorX = $w - 120
$sampleColorY = $h - 80

# Ensure we don't go out of bounds on tiny images
if ($sampleColorX -lt 0) { $sampleColorX = 0 }
if ($sampleColorY -lt 0) { $sampleColorY = 0 }

$bgColor = $newImage.GetPixel($sampleColorX, $sampleColorY)
$brush = New-Object System.Drawing.SolidBrush($bgColor)

# Draw a rectangle covering the entire bottom right corner (110x70)
$rectW = 110
$rectH = 70
$rectX = $w - $rectW
$rectY = $h - $rectH

if ($rectX -lt 0) { $rectX = 0; $rectW = $w }
if ($rectY -lt 0) { $rectY = 0; $rectH = $h }

$graphics.FillRectangle($brush, $rectX, $rectY, $rectW, $rectH)

$graphics.Dispose()
$brush.Dispose()
$sourceImage.Dispose()

$newImage.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
$newImage.Dispose()

Write-Output "Successfully removed watermark and saved to $targetPath!"
