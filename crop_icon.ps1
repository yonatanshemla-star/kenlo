Add-Type -AssemblyName System.Drawing

$sourcePath = "C:\Users\Yonatan\.gemini\antigravity\brain\6f497cd1-9d8e-4866-a9d4-4ff10e0a5ec4\media__1774855058723.png"
$targetPath = "C:\Users\Yonatan\.gemini\antigravity\scratch\movie-ranker\icon.png"

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)

# We want a center-cropped square!
$minSize = [math]::Min($sourceImage.Width, $sourceImage.Height)

$newImage = New-Object System.Drawing.Bitmap $minSize, $minSize
$graphics = [System.Drawing.Graphics]::FromImage($newImage)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# The crop window (from the center)
# If width > height, xOffset > 0. 
$xOff = ($sourceImage.Width - $minSize) / 2
$yOff = ($sourceImage.Height - $minSize) / 2

$destRect = New-Object System.Drawing.Rectangle(0, 0, $minSize, $minSize)
$srcRect = New-Object System.Drawing.Rectangle([int]$xOff, [int]$yOff, $minSize, $minSize)

$graphics.DrawImage($sourceImage, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

$graphics.Dispose()
$sourceImage.Dispose()

$newImage.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
$newImage.Dispose()

Write-Output "Successfully center-cropped icon to pure square: $minSize x $minSize!"
