param(
  [Parameter(Mandatory = $true)]
  [string]$Tag
)

$ErrorActionPreference = "Stop"
$versionPattern = '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
if ($Tag -cnotmatch $versionPattern) {
  throw "Release tag must be a version such as v0.1.0 or v0.2.0-beta.1: $Tag"
}

$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$desktopRoot = Join-Path $repositoryRoot "desktop"
$config = Get-Content -Raw -LiteralPath (Join-Path $desktopRoot "src-tauri/tauri.conf.json") | ConvertFrom-Json
$package = Get-Content -Raw -LiteralPath (Join-Path $desktopRoot "package.json") | ConvertFrom-Json
$packageLock = Get-Content -Raw -LiteralPath (Join-Path $desktopRoot "package-lock.json") | ConvertFrom-Json -AsHashtable
$manifestPath = (Resolve-Path -LiteralPath (Join-Path $desktopRoot "src-tauri/Cargo.toml")).Path
$metadataJson = & cargo metadata --manifest-path $manifestPath --locked --no-deps --format-version 1
if ($LASTEXITCODE -ne 0) {
  throw "Could not read the Rust application version."
}
$metadata = ($metadataJson -join "`n") | ConvertFrom-Json
$rustPackage = $metadata.packages | Where-Object { $_.manifest_path -eq $manifestPath }
if (!$rustPackage) {
  throw "The Rust application package was not found in Cargo metadata."
}

$version = $Tag.Substring(1)
$versions = [ordered]@{
  "tauri.conf.json" = $config.version
  "package.json" = $package.version
  "package-lock.json" = $packageLock.version
  "package-lock.json root package" = $packageLock["packages"][""]["version"]
  "Cargo.toml" = $rustPackage.version
}
foreach ($entry in $versions.GetEnumerator()) {
  if ($entry.Value -cne $version) {
    throw "$($entry.Key) has version '$($entry.Value)', but the tag requires '$version'."
  }
}

$prerelease = $version.Split("+")[0].Contains("-").ToString().ToLowerInvariant()
$installerName = "CreatorTool_${version}_windows_x64-setup.exe" -replace '[^0-9A-Za-z_.-]', '.'
if ($env:GITHUB_OUTPUT) {
  $outputs = @(
    "tag=$Tag"
    "version=$version"
    "prerelease=$prerelease"
    "installer_name=$installerName"
  )
  [IO.File]::AppendAllText($env:GITHUB_OUTPUT, ($outputs -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
}
Write-Output "Validated release $Tag ($installerName)."
