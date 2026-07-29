param(
  [int]$Threshold = 800,
  [string]$Root = "src"
)

$extensions = @(".ts", ".tsx", ".js", ".jsx", ".css", ".sql")
$excludedSegments = @(
  "node_modules", "dist", "build", "release", "coverage", "vendor", "generated"
)

$files = Get-ChildItem -LiteralPath $Root -Recurse -File |
  Where-Object {
    $extensions -contains $_.Extension.ToLowerInvariant() -and
    $_.Name -notmatch '\.(map|snap)$' -and
    -not ($excludedSegments | Where-Object {
      $_.FullName -split '[\\/]' -contains $_
    })
  }

$results = foreach ($file in $files) {
  $lineCount = [System.IO.File]::ReadAllLines($file.FullName).Length
  if ($lineCount -lt $Threshold) { continue }

  $relativePath = [System.IO.Path]::GetRelativePath(
    (Get-Location).Path,
    $file.FullName
  )
  $classification = if ($relativePath -match '[\\/]styles?[\\/]|\.css$') {
    "stylesheet-exemption-candidate"
  } elseif ($relativePath -match 'seed-data|fixtures?|constants') {
    "declarative-data-exemption-candidate"
  } elseif ($relativePath -match 'types?[\\/]|types?\.') {
    "type-registry-exemption-candidate"
  } elseif ($relativePath -match 'database|migrations?') {
    "migration-exemption-candidate"
  } else {
    "authored-executable"
  }

  [pscustomobject]@{
    Path = $relativePath
    PhysicalLines = $lineCount
    Classification = $classification
  }
}

$results | Sort-Object PhysicalLines -Descending
