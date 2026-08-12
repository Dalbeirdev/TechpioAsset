<#
.SYNOPSIS
    TechpioAsset inventory agent for Windows.

.DESCRIPTION
    Reports this machine's hardware, operating system and installed software to
    your TechpioAsset portal so the asset record stays current without anyone
    typing it in.

    WHAT IT DOES NOT DO, by design:
      * no remote command execution
      * no file, document or browsing-history access
      * no screen capture, no keystrokes, no location
      * no personal data beyond the Windows user name of local administrators
        (a count only - see Get-OsInfo)

    It is report-only and one-way: the agent POSTs, the portal never pushes
    anything back. The whole script is plain text so your IT team can read
    exactly what leaves the machine before trusting it.

.PARAMETER PortalUrl
    Base URL of the API, e.g. https://piotask.com/api/v1

.PARAMETER EnrolmentToken
    The company enrolment token from Discovery -> Agents. Needed only on the
    first run; afterwards the device credential is used.

.PARAMETER Install
    Registers a daily scheduled task that runs this script as SYSTEM.

.EXAMPLE
    .\TechpioAgent.ps1 -PortalUrl https://piotask.com/api/v1 -EnrolmentToken tae_xxx -Install

.NOTES
    Requires Windows PowerShell 5.1+ (present on every supported Windows) or
    PowerShell 7. Run elevated for the full picture: TPM, BitLocker and patch
    state are not readable as a standard user, and those fields are simply
    reported as null rather than guessed.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PortalUrl,
    [string]$EnrolmentToken,
    [switch]$Install,
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:AgentVersion = '1.0.0'
$script:StateDir     = Join-Path $env:ProgramData 'TechpioAsset'
$script:StateFile    = Join-Path $script:StateDir 'agent.json'
$script:TaskName     = 'TechpioAsset Inventory Agent'

# ── helpers ──────────────────────────────────────────────────────────────────

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    try {
        if (-not (Test-Path $script:StateDir)) { New-Item -ItemType Directory -Path $script:StateDir -Force | Out-Null }
        Add-Content -Path (Join-Path $script:StateDir 'agent.log') -Value $line -ErrorAction SilentlyContinue
    } catch { }
}

<#
    Anything that reads hardware can fail on an odd machine - a missing WMI
    class, a locked-down VM, a laptop with no battery. A field we cannot read
    is reported as null; it is never guessed, and it never stops the run.
#>
function Try-Get {
    param([scriptblock]$Block)
    try { & $Block } catch { $null }
}


<#
    Reads a property that may not exist, without tripping StrictMode.
    Registry-derived objects are the reason this exists: two machines rarely
    expose the same set of value names.
#>
function Get-Prop {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

<#
    The status code of a failed web call, or $null.

    Windows PowerShell 5.1 and PowerShell 7 raise different exception types
    here, and Set-StrictMode makes reading a property that does not exist a
    terminating error - so the shape is probed rather than assumed. Without
    this the error handler itself became the error.
#>
function Get-HttpStatus {
    param($ErrorRecord)
    try {
        $ex = $ErrorRecord.Exception
        if ($null -eq $ex) { return $null }
        $response = $ex.PSObject.Properties['Response']
        if ($null -eq $response -or $null -eq $response.Value) { return $null }
        $status = $response.Value.PSObject.Properties['StatusCode']
        if ($null -eq $status -or $null -eq $status.Value) { return $null }
        return [int]$status.Value
    } catch { return $null }
}

function Get-MachineId {
    # The hardware UUID is stable across OS reinstalls, which is what makes it
    # the right identity: rebuilding a laptop must not create a second asset.
    $uuid = Try-Get { (Get-CimInstance Win32_ComputerSystemProduct).UUID }
    if ($uuid -and $uuid -notmatch '^(0{8}-|FFFFFFFF-)') { return $uuid }
    # Fall back to the machine GUID; still stable, less portable.
    $guid = Try-Get {
        (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid
    }
    if ($guid) { return $guid }
    return "$env:COMPUTERNAME-$([System.Environment]::MachineName)"
}

# ── state (device credential) ────────────────────────────────────────────────

function Get-State {
    if (-not (Test-Path $script:StateFile)) { return $null }
    try { Get-Content $script:StateFile -Raw | ConvertFrom-Json } catch { $null }
}

function Save-State {
    param([string]$DeviceToken, [string]$MachineId)
    if (-not (Test-Path $script:StateDir)) {
        New-Item -ItemType Directory -Path $script:StateDir -Force | Out-Null
    }
    # The credential is scoped to this one machine and can only post this
    # machine's inventory, but it is still a secret: the file is readable by
    # administrators and SYSTEM only.
    try {
        @{ deviceToken = $DeviceToken; machineId = $MachineId; version = $script:AgentVersion } |
            ConvertTo-Json | Set-Content -Path $script:StateFile -Encoding UTF8
    } catch {
        # The state file is deliberately locked to SYSTEM and Administrators, so
        # an unelevated run cannot rewrite one an elevated run created. That is
        # the ACL doing its job, not a failure worth aborting for: this run still
        # holds the credential in memory and can report. Say so and carry on.
        $reason = $_.Exception.Message
        Write-Log "Could not persist the device credential ($reason). This run will still report; run elevated (or via the scheduled task, which runs as SYSTEM) to store it." 'WARN'
        return
    }

    # Lock the credential down to SYSTEM and Administrators. Best-effort: on a
    # machine where the ACL cannot be set, a readable-but-working agent beats a
    # dead one, and the credential can still only describe this laptop.
    try {
        $acl = Get-Acl $script:StateFile
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($who in @('SYSTEM', 'Administrators')) {
            $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
                $who, 'FullControl', 'Allow')))
        }
        Set-Acl -Path $script:StateFile -AclObject $acl
    } catch {
        Write-Log ("Could not restrict permissions on the state file: {0}" -f $_.Exception.Message) 'WARN'
    }
}

# ── collection ───────────────────────────────────────────────────────────────

function Get-HardwareInfo {
    $cs      = Try-Get { Get-CimInstance Win32_ComputerSystem }
    $bios    = Try-Get { Get-CimInstance Win32_BIOS }
    $cpu     = Try-Get { Get-CimInstance Win32_Processor | Select-Object -First 1 }
    $gpu     = Try-Get { Get-CimInstance Win32_VideoController | Select-Object -First 1 }
    $memory  = Try-Get { @(Get-CimInstance Win32_PhysicalMemory) }
    $array   = Try-Get { Get-CimInstance Win32_PhysicalMemoryArray | Select-Object -First 1 }
    $sysDisk = Try-Get { Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'" }
    $battery = Try-Get { Get-CimInstance Win32_Battery | Select-Object -First 1 }

    # SMART: healthy unless a physical disk says otherwise.
    $smart = Try-Get {
        $states = @(Get-CimInstance -Namespace root\Microsoft\Windows\Storage -ClassName MSFT_PhysicalDisk |
                    Select-Object -ExpandProperty HealthStatus)
        if ($states -contains 2) { 'FAILING' } elseif ($states -contains 1) { 'WARNING' } else { 'HEALTHY' }
    }

    # Battery health = full charge capacity vs design capacity.
    $batteryPct = Try-Get {
        $full   = (Get-CimInstance -Namespace root\WMI -ClassName BatteryFullChargedCapacity -ErrorAction Stop |
                   Select-Object -First 1).FullChargedCapacity
        $design = (Get-CimInstance -Namespace root\WMI -ClassName BatteryStaticData -ErrorAction Stop |
                   Select-Object -First 1).DesignedCapacity
        if ($design -gt 0) { [int][math]::Round(($full / $design) * 100) } else { $null }
    }

    [ordered]@{
        manufacturer      = Try-Get { $cs.Manufacturer }
        modelName         = Try-Get { $cs.Model }
        cpu               = Try-Get { $cpu.Name }
        cpuCores          = Try-Get { [int]$cpu.NumberOfCores }
        ramGb             = Try-Get { [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) }
        ramSlotsUsed      = Try-Get { @($memory).Count }
        ramSlotsTotal     = Try-Get { [int]$array.MemoryDevices }
        storageTotalGb    = Try-Get { [math]::Round($sysDisk.Size / 1GB, 1) }
        storageFreeGb     = Try-Get { [math]::Round($sysDisk.FreeSpace / 1GB, 1) }
        smartStatus       = $smart
        batteryHealthPct  = $batteryPct
        batteryCycleCount = Try-Get { [int]$battery.CycleCount }
        gpu               = Try-Get { $gpu.Name }
        biosVersion       = Try-Get { $bios.SMBIOSBIOSVersion }
    }
}

function Get-OsInfo {
    $os = Try-Get { Get-CimInstance Win32_OperatingSystem }

    $encrypted = Try-Get {
        # 1 = fully encrypted. Needs elevation; null when not readable.
        $v = Get-CimInstance -Namespace root\CIMV2\Security\MicrosoftVolumeEncryption `
             -ClassName Win32_EncryptableVolume -ErrorAction Stop |
             Where-Object { $_.DriveLetter -eq $env:SystemDrive } | Select-Object -First 1
        if ($null -ne $v) { [bool]($v.GetConversionStatus().ConversionStatus -eq 1) } else { $null }
    }

    [ordered]@{
        osName                 = Try-Get { $os.Caption }
        osVersion              = Try-Get { $os.Version }
        osBuild                = Try-Get { $os.BuildNumber }
        osActivated            = Try-Get {
            $lic = Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND Name LIKE 'Windows%'" |
                   Select-Object -First 1
            [bool]($lic.LicenseStatus -eq 1)
        }
        lastBootAt             = Try-Get { $os.LastBootUpTime.ToString('o') }
        diskEncrypted          = $encrypted
        defenderEnabled        = Try-Get { [bool](Get-MpComputerStatus).RealTimeProtectionEnabled }
        firewallEnabled        = Try-Get { [bool](@(Get-NetFirewallProfile | Where-Object Enabled).Count -gt 0) }
        tpmPresent             = Try-Get { [bool](Get-Tpm).TpmPresent }
        # A COUNT of local administrators, never their names: "how many people
        # can change this machine" is an asset-risk signal; who they are is not
        # the asset system's business.
        localAdminCount        = Try-Get { @(Get-LocalGroupMember -Group 'Administrators').Count }
        missingCriticalPatches = Try-Get {
            $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
            @($searcher.Search("IsInstalled=0 AND Type='Software'").Updates).Count
        }
    }
}

function Get-InstalledSoftware {
    <#
        Read from the uninstall registry keys, NOT Win32_Product.
        Win32_Product triggers an MSI consistency check on every installed
        package - it is slow and can silently start repair operations on a
        user's machine. The registry is what Add/Remove Programs itself reads.
    #>
    $paths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    # StrictMode turns "read a property this key does not have" into a
    # terminating error, and uninstall keys are wildly inconsistent - plenty
    # carry no DisplayName at all. Every read goes through Get-Prop.
    $items = foreach ($path in $paths) {
        Try-Get { @(Get-ItemProperty $path -ErrorAction SilentlyContinue) }
    }

    $seen = @{}
    $out = foreach ($item in $items) {
        if ($null -eq $item) { continue }
        $name = Get-Prop $item 'DisplayName'
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        # Hide OS components and driver/update entries; these are not software
        # anyone manages, and they bury the applications that matter.
        if (Get-Prop $item 'SystemComponent') { continue }
        if (Get-Prop $item 'ReleaseType') { continue }
        if (Get-Prop $item 'ParentKeyName') { continue }

        $version = Get-Prop $item 'DisplayVersion'
        $key = "$name|$version"
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true

        $rawDate = Get-Prop $item 'InstallDate'
        $installed = $null
        if ($rawDate -and "$rawDate" -match '^\d{8}$') {
            $installed = Try-Get {
                [datetime]::ParseExact("$rawDate", 'yyyyMMdd', $null).ToString('o')
            }
        }
        [ordered]@{
            name        = [string]$name
            version     = if ($version) { [string]$version } else { $null }
            publisher   = $(if ($p = Get-Prop $item 'Publisher') { [string]$p } else { $null })
            installedAt = $installed
        }
    }
    # The API accepts up to 5000 entries; stay well inside it.
    @($out | Select-Object -First 2000)
}

# ── portal calls ─────────────────────────────────────────────────────────────

function Invoke-Portal {
    param([string]$Path, [hashtable]$Headers, $Body)
    $uri = "$($PortalUrl.TrimEnd('/'))$Path"
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    # -UseBasicParsing keeps this working on Server Core, where IE's DOM parser
    # is absent.
    Invoke-RestMethod -Uri $uri -Method Post -Headers $Headers -Body $json `
        -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60
}

function Register-Agent {
    param([string]$MachineId)
    if (-not $EnrolmentToken) {
        throw "This machine is not enrolled yet and no -EnrolmentToken was supplied."
    }
    Write-Log "Enrolling $MachineId"
    $body = @{
        machineId    = $MachineId
        hostname     = $env:COMPUTERNAME
        serialNumber = Try-Get { (Get-CimInstance Win32_BIOS).SerialNumber }
        platform     = 'windows'
        agentVersion = $script:AgentVersion
    }
    $res = Invoke-Portal -Path '/discovery/agents/enrol' `
        -Headers @{ 'x-enrolment-token' = $EnrolmentToken } -Body $body
    $token = $res.data.deviceToken
    if (-not $token) { throw 'Enrolment did not return a device credential.' }
    Save-State -DeviceToken $token -MachineId $MachineId
    Write-Log 'Enrolled; device credential stored.'
    return $token
}

function Send-Inventory {
    param([string]$DeviceToken)
    Write-Log 'Collecting inventory'
    $payload = [ordered]@{
        hostname     = $env:COMPUTERNAME
        serialNumber = Try-Get { (Get-CimInstance Win32_BIOS).SerialNumber }
        agentVersion = $script:AgentVersion
        hardware     = Get-HardwareInfo
        os           = Get-OsInfo
        software     = Get-InstalledSoftware
    }
    Write-Log ("Reporting {0} software entries" -f @($payload.software).Count)
    $res = Invoke-Portal -Path '/discovery/agents/report' `
        -Headers @{ Authorization = "Bearer $DeviceToken" } -Body $payload
    Write-Log ("Reported. Portal matched={0} proposed={1} unmatched={2}" -f `
        $res.data.matched, $res.data.proposed, $res.data.unmatched)
}

# ── scheduled task ───────────────────────────────────────────────────────────

function Install-Task {
    # $MyInvocation.MyCommand inside a function is the FUNCTION's info, which
    # has no .Path - under StrictMode that read is the crash a real install
    # died on. $PSCommandPath is the script-level automatic variable and is
    # correct in both Windows PowerShell 5.1 and PowerShell 7.
    $self = $PSCommandPath

    # The install one-liner downloads the script to %TEMP%, which temp
    # cleanup empties and the SYSTEM account may not read at all. The task
    # must outlive both, so the agent copies itself next to its state file
    # and schedules THAT copy.
    if (-not (Test-Path $script:StateDir)) {
        New-Item -ItemType Directory -Path $script:StateDir -Force | Out-Null
    }
    $home_ = Join-Path $script:StateDir 'TechpioAgent.ps1'
    if ($self -ne $home_) {
        Copy-Item -Path $self -Destination $home_ -Force
        $self = $home_
    }

    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$self`" -PortalUrl `"$PortalUrl`""
    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args
    # Daily, plus at start-up so a laptop that was off overnight still reports.
    # The +/-30min jitter belongs to the TRIGGER - RandomDelay is not a
    # parameter of New-ScheduledTaskSettingsSet, and PowerShell 5.1 says so
    # only at run time, on a real machine, during a real install.
    $daily   = New-ScheduledTaskTrigger -Daily -At 12pm -RandomDelay (New-TimeSpan -Minutes 30)
    $startup = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable `
                    -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

    Register-ScheduledTask -TaskName $script:TaskName -Action $action `
        -Trigger @($daily, $startup) -Principal $principal -Settings $settings -Force | Out-Null
    Write-Log "Scheduled task '$($script:TaskName)' installed (daily 12:00 +/-30m, and at start-up)."
}

function Uninstall-Task {
    Try-Get { Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false }
    Write-Log "Scheduled task removed. State kept at $script:StateFile (delete it to fully unenrol)."
}

# ── main ─────────────────────────────────────────────────────────────────────

try {
    if ($Uninstall) { Uninstall-Task; return }

    $machineId = Get-MachineId
    $state = Get-State
    $deviceToken = if ($state -and $state.deviceToken) { $state.deviceToken } else { $null }

    if (-not $deviceToken) { $deviceToken = Register-Agent -MachineId $machineId }

    try {
        Send-Inventory -DeviceToken $deviceToken
    } catch {
        # A revoked or rotated credential reads as 401. Re-enrol once if we were
        # given a token to do it with, so a re-issued laptop heals itself.
        if ((Get-HttpStatus $_) -eq 401 -and $EnrolmentToken) {
            Write-Log 'Device credential rejected; re-enrolling.' 'WARN'
            $deviceToken = Register-Agent -MachineId $machineId
            Send-Inventory -DeviceToken $deviceToken
        } else {
            throw
        }
    }

    if ($Install) { Install-Task }
    Write-Log 'Done.'
} catch {
    Write-Log $_.Exception.Message 'ERROR'
    exit 1
}
