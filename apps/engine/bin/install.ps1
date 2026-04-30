$ErrorActionPreference = "Stop"

foreach ($cmd in @("node", "npm", "git")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Error "beerengineer install prerequisite missing: $cmd. Install Node.js 22+, npm, and Git, then rerun this PowerShell command."
    exit 1
  }
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $ScriptDir "beerengineer.js") install --from-bootstrap windows @args
exit $LASTEXITCODE
