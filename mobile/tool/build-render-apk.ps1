param(
  [Parameter(Mandatory = $true)]
  [string] $ApiBaseUrl
)

$ErrorActionPreference = 'Stop'
$uri = $null
if (-not [Uri]::TryCreate($ApiBaseUrl, [UriKind]::Absolute, [ref]$uri) -or
    $uri.Scheme -ne 'https' -or
    $uri.Host -in @('localhost', '127.0.0.1', '10.0.2.2') -or
    $uri.AbsolutePath.TrimEnd('/') -ne '/api/v1') {
  throw 'Pass a public HTTPS API URL ending in /api/v1.'
}

$mobileRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputDir = Join-Path $mobileRoot 'build/app/outputs/flutter-apk'
$expected = Join-Path $outputDir 'app-arm64-v8a-profile.apk'
Push-Location $mobileRoot
try {
  & flutter.bat build apk --profile --target-platform android-arm64 --split-per-abi --no-pub "--dart-define=API_BASE_URL=$ApiBaseUrl"
  if ($LASTEXITCODE -ne 0) { throw 'Flutter APK build failed.' }
  if (-not (Test-Path -LiteralPath $expected -PathType Leaf)) {
    throw 'Expected arm64 APK was not created.'
  }
  $resolvedOutput = (Resolve-Path -LiteralPath $outputDir).Path
  if (-not $resolvedOutput.StartsWith($mobileRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'APK output directory is outside the mobile project.'
  }
  Get-ChildItem -LiteralPath $resolvedOutput -Filter '*.apk' -File |
    Where-Object { $_.FullName -ne $expected } |
    Remove-Item -Force
  Write-Output "APK ready: $expected"
} finally {
  Pop-Location
}
