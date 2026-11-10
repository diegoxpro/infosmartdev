# Enciende el sistema (si no está encendido) y abre el navegador.
param([switch]$SinNavegador)
. (Join-Path $PSScriptRoot 'comun.ps1')

Cargar-Config | Out-Null
$puerto = Puerto
$url = "http://localhost:$puerto"

if (-not (Sistema-Encendido $puerto)) {
  New-Item -ItemType Directory -Force -Path $Logs | Out-Null
  $log = Join-Path $Logs 'sistema.log'
  if (Test-Path -LiteralPath $log) { Move-Item -LiteralPath $log -Destination (Join-Path $Logs 'sistema-anterior.log') -Force }

  # cmd guarda la salida en el log aunque esta ventana se cierre.
  $si = New-Object Diagnostics.ProcessStartInfo
  $si.FileName = "$env:SystemRoot\System32\cmd.exe"
  $si.Arguments = "/c `"`"$Node`" dist\main.js > `"$log`" 2>&1`""
  $si.WorkingDirectory = $Backend
  $si.UseShellExecute = $false
  $si.CreateNoWindow = $true
  $p = [Diagnostics.Process]::Start($si)
  Set-Content -LiteralPath $PidFile -Value $p.Id

  $listo = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Milliseconds 500
    if (Sistema-Encendido $puerto) { $listo = $true; break }
    if ($p.HasExited) { break }
  }
  if (-not $listo) {
    Mensaje "El sistema no pudo arrancar. Revisa que PostgreSQL esté encendido.`n`nDetalle del error en:`n$log" 16
    exit 1
  }
}

if (-not $SinNavegador) { Abrir-Navegador $url }
