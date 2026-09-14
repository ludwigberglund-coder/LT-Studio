$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$parts = Get-ChildItem 'rollands-source.tar.xz.b64.part*' | Sort-Object Name
$base64 = ($parts | ForEach-Object { Get-Content $_.FullName -Raw }) -join ''
[IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'rollands-source.tar.xz'), [Convert]::FromBase64String($base64))
Write-Host "Created: $PSScriptRoot\rollands-source.tar.xz"
Write-Host 'Extract with a tool that supports .tar.xz (for example 7-Zip or tar on recent Windows).'
