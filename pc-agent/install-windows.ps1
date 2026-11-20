<#
  pc-agent on Windows: a private Python environment, then a task that starts it (hidden) when you sign in.

    powershell -ExecutionPolicy Bypass -File pc-agent\install-windows.ps1              # install / update, start now
    powershell -ExecutionPolicy Bypass -File pc-agent\install-windows.ps1 -Uninstall   # stop and remove the task

  Settings: pc-agent\.env (copy .env.example). Log: pc-agent\agent.log.
#>
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$task = 'VEGA pc-agent'

if ($Uninstall) {
  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed the task '$task'. The folder pc-agent\.venv can be deleted by hand."
  return
}

$venv = Join-Path $here '.venv'
if (-not (Test-Path "$venv\Scripts\python.exe")) {
  Write-Host 'Creating pc-agent\.venv ...'
  py -3 -m venv $venv
}
& "$venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
& "$venv\Scripts\python.exe" -m pip install --quiet -r (Join-Path $here 'requirements.txt')
& "$venv\Scripts\python.exe" -m pip install --quiet --no-deps openwakeword==0.6.0  # see requirements.txt
if (-not (Test-Path (Join-Path $here '.env'))) { Copy-Item (Join-Path $here '.env.example') (Join-Path $here '.env') }

# pythonw: no console window; the agent writes pc-agent\agent.log instead
$action = New-ScheduledTaskAction -Execute "$venv\Scripts\pythonw.exe" -Argument "`"$here\main.py`"" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Description 'VEGA: wake word on this PC (docs/decisions/0009)' -Force | Out-Null
Start-ScheduledTask -TaskName $task
Write-Host "Installed and started '$task'. It starts again at every sign-in. Log: $here\agent.log"
