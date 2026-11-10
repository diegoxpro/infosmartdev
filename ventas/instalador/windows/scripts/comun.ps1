# Rutas y funciones que usan iniciar, detener e instalar.
$ErrorActionPreference = 'Stop'

$Raiz      = Split-Path -Parent $PSScriptRoot
$App       = Join-Path $Raiz 'app'
$Node      = Join-Path $App 'node\node.exe'
$Backend   = Join-Path $App 'backend'
$Datos     = Join-Path $Raiz 'datos'
$Logs      = Join-Path $Raiz 'logs'
$ConfigEnv = Join-Path $Datos 'config.env'
$PidFile   = Join-Path $Logs 'sistema.pid'

# Lee datos\config.env y deja cada valor como variable de entorno del proceso.
function Cargar-Config {
  param([string]$Archivo = $ConfigEnv)
  $cfg = @{}
  foreach ($linea in Get-Content -LiteralPath $Archivo -Encoding UTF8) {
    if ($linea -match '^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$') { $cfg[$matches[1]] = $matches[2] }
  }
  foreach ($k in $cfg.Keys) { [Environment]::SetEnvironmentVariable($k, $cfg[$k], 'Process') }
  $env:CHECKPOINT_DISABLE = '1'
  $env:PRISMA_HIDE_UPDATE_MESSAGE = '1'
  return $cfg
}

function Puerto {
  if ($env:PORT) { return [int]$env:PORT }
  return 3000
}

function Sistema-Encendido {
  param([int]$Puerto)
  try {
    $c = New-Object Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $Puerto)
    $c.Close()
    return $true
  } catch { return $false }
}

# Corre un programa mostrando su salida en pantalla y devuelve el código de salida.
function Ejecutar {
  param([string]$Exe, [string[]]$Argumentos)
  $antes = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $Exe @Argumentos | Out-Host
  $codigo = $LASTEXITCODE
  $ErrorActionPreference = $antes
  return $codigo
}

function Mensaje {
  param([string]$Texto, [int]$Icono = 64)
  (New-Object -ComObject WScript.Shell).Popup($Texto, 0, "Candy's Market", $Icono) | Out-Null
}

# Chrome con --kiosk-printing imprime el ticket sin el cuadro de diálogo.
function Abrir-Navegador {
  param([string]$Url)
  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if ($chrome) { Start-Process -FilePath $chrome -ArgumentList '--kiosk-printing', $Url }
  else { Start-Process $Url }
}
