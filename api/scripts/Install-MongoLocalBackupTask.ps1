$ErrorActionPreference = 'Stop'
try {
    $taskName = 'AFHomes MongoDB encrypted local backup'
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) { throw 'Existing task requires review' }
    $runner = Join-Path $PSScriptRoot 'Run-MongoLocalBackup.ps1'
    $repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -File "{0}"' -f $runner) -WorkingDirectory $repo
    $trigger = New-ScheduledTaskTrigger -Daily -At '21:00'
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Encrypted afhomes_dev/private-file capture and independent disposable restore verification. Runs only for the signed-in Windows user; retains all archives.' | Out-Null
    @{ installed = $true; task = $taskName; dailyLocalTime = '21:00'; requiresUserSignIn = $true; automaticDeletion = $false } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine('Backup task installation stopped. No credentials or raw errors printed; an existing task was not replaced.')
    exit 1
}
