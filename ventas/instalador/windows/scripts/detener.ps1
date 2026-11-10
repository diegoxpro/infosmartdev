# Apaga el sistema.
param([switch]$Silencioso)
. (Join-Path $PSScriptRoot 'comun.ps1')

if (Test-Path -LiteralPath $PidFile) {
  $id = (Get-Content -LiteralPath $PidFile | Select-Object -First 1).Trim()
  # Por cmd: en PowerShell 5 un error de taskkill detendría el script.
  if ($id) { & cmd.exe /c "taskkill /T /F /PID $id >nul 2>&1" }
  Remove-Item -LiteralPath $PidFile -Force
}

# Por si quedó encendido un node de esta instalación.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.ExecutablePath -eq $Node } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if (-not $Silencioso) { Mensaje "Candy's Market se cerró." }
