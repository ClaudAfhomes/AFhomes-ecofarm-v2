param([switch]$ExportKeyForProcess)
$ErrorActionPreference = 'Stop'
$stage = 'initialization'
try {
    Add-Type -AssemblyName System.Security
    $userRoot = [Environment]::GetFolderPath('UserProfile')
    $backupRoot = Join-Path $userRoot '.afhomes\backups\afhomes_dev'
    $keyRoot = Join-Path $userRoot '.afhomes\backup-keys'
    $keyPath = Join-Path $keyRoot 'afhomes_dev.v1.dpapi'
    if (-not $ExportKeyForProcess) {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        foreach ($directory in @($backupRoot, $keyRoot)) {
            $stage = 'directory-create'
            [IO.Directory]::CreateDirectory($directory) | Out-Null
            $stage = 'directory-inspection'
            if ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked directory refused' }
            $stage = 'directory-permissions'
            $grant = '*{0}:(OI)(CI)(F)' -f $sid.Value
            & icacls.exe $directory '/inheritance:r' '/grant:r' $grant *> $null
            if ($LASTEXITCODE -ne 0) { throw 'Directory permission setup failed' }
        }
        if (-not (Test-Path -LiteralPath $keyPath)) {
            $stage = 'key-create'
            $key = New-Object byte[] 32
            $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
            try { $rng.GetBytes($key) } finally { $rng.Dispose() }
            $protected = [Security.Cryptography.ProtectedData]::Protect($key, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
            $stream = [IO.File]::Open($keyPath, [IO.FileMode]::CreateNew)
            try { $stream.Write($protected, 0, $protected.Length) } finally { $stream.Dispose(); [Array]::Clear($key, 0, $key.Length) }
        }
    }
    $stage = 'key-recovery'
    $clear = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($keyPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try {
        if ($clear.Length -ne 32) { throw 'Invalid key length' }
        if ($ExportKeyForProcess) { [Console]::Write([Convert]::ToBase64String($clear)) }
        else { @{ configured = $true; backupRoot = $backupRoot; keyFile = $keyPath; keyProtection = 'Windows DPAPI CurrentUser'; offDeviceCopy = $false } | ConvertTo-Json -Compress }
    } finally { [Array]::Clear($clear, 0, $clear.Length) }
} catch {
    [Console]::Error.WriteLine("Local backup setup failed at $stage ($($_.Exception.GetType().Name)). No key material or raw errors printed.")
    exit 1
}
