$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$database = Join-Path $root 'database'
$docs = Join-Path $root 'docs'

Write-Output 'Repository layout check:'
Write-Output "backend  = $backend"
Write-Output "frontend = $frontend"
Write-Output "database = $database"
Write-Output "docs     = $docs"

foreach ($path in @($backend, $frontend, $database, $docs)) {
  if (-not (Test-Path $path)) {
    throw "Missing required directory: $path"
  }
}

Write-Output ''
Write-Output 'This repository snapshot stores the repository layout, SQL artifacts and interface materials.'
Write-Output 'Use backend\\migrate.js and backend\\seed_demo_events.js to prepare the local database contour.'
