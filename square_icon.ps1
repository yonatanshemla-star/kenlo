Add-Type -AssemblyName System.Drawing

$sourcePath = "C:\Users\Yonatan\.gemini\antigravity\scratch\movie-ranker\icon.png"
$backupPath = "C:\Users\Yonatan\.gemini\antigravity\scratch\movie-ranker\icon_bak.png"

# Backup the original image
Copy-Item $sourcePath $backupPath

$sourceImage = [System.Drawing.Image]::FromFile($backupPath)

# Calculate dimensions for a square image (max of width/height)
$size = [math]::Max($sourceImage.Width, $sourceImage.Height)

# Create a new blank bitmap
$newImage = New-Object System.Drawing.Bitmap $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($newImage)

# Fill background with dark navy blue matching the image corners (#020617)
$darkBlue = [System.Drawing.Color]::FromArgb(255, 2, 6, 23)
$brush = New-Object System.Drawing.SolidBrush($darkBlue)
$graphics.FillRectangle($brush, 0, 0, $size, $size)

# Calculate where to draw the original image so it's centered
$x = ($size - $sourceImage.Width) / 2
$y = ($size - $sourceImage.Height) / 2

# Draw the original image onto the new squared background
$graphics.DrawImage($sourceImage, [int]$x, [int]$y, $sourceImage.Width, $sourceImage.Height)

# Dispose of resources
$brush.Dispose()
$graphics.Dispose()
$sourceImage.Dispose()

# Save the new properly formatted image over the icon.png
$newImage.Save($sourcePath, [System.Drawing.Imaging.ImageFormat]::Png)
$newImage.Dispose()

Write-Output "Successfully squared icon to $size x $size!"
