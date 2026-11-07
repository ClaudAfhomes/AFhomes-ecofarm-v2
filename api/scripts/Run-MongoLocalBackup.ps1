$ErrorActionPreference = 'Stop'
$backupRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.afhomes\backups\afhomes_dev'
$stage = 'configuration'
try {
    $repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $tsx = Join-Path $repo 'node_modules\tsx\dist\cli.mjs'
    $script = Join-Path $PSScriptRoot 'backup-mongodb-local.ts'
    $stage = 'capture'
    $captured = & $node $tsx $script capture 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Capture failed' }
    $capture = $captured | ConvertFrom-Json
    if (-not $capture.captured) { throw 'Capture result invalid' }
    $stage = 'restore-verification'
    $restored = & $node $tsx $script verify $capture.file 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed' }
    $verify = $restored | ConvertFrom-Json
    if (-not $verify.verifiedRestore -or $verify.sha256 -ne $capture.sha256) { throw 'Restore result invalid' }
    $report = @{ success = $true; completedAt = [DateTime]::UtcNow.ToString('o'); file = $capture.file; sha256 = $capture.sha256; collections = $verify.collections; documents = $verify.documents; files = $verify.files; offDeviceCopy = $false }
    $report | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $backupRoot 'latest-task.json') -Encoding UTF8
    $report | ConvertTo-Json -Compress
} catch {
    $report = @{ success = $false; failedAt = [DateTime]::UtcNow.ToString('o'); stage = $stage; rawErrorsWithheld = $true }
    if (Test-Path -LiteralPath $backupRoot) { $report | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $backupRoot 'latest-task.json') -Encoding UTF8 }
    $report | ConvertTo-Json -Compress
    exit 1
}
