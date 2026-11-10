# Instala o actualiza Candy's Market en esta PC.
# Lo abre INSTALAR.bat (o ACTUALIZAR.bat con -Actualizar); no necesita internet.
# actualizar-github.ps1 lo llama con -Destino y -SinPreguntas tras armar el paquete nuevo.
param([switch]$Actualizar, [string]$Destino, [switch]$SinPreguntas)
. (Join-Path $PSScriptRoot 'comun.ps1')

$Paquete = Split-Path -Parent $PSScriptRoot          # ...\paquete
$Carpeta = Split-Path -Parent $Paquete               # carpeta donde está INSTALAR.bat
$Base    = 'candys'
$Hoy     = Get-Date -Format 'yyyy-MM-dd_HHmm'

function Titulo($t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Magenta }
function Ok($t)     { Write-Host $t -ForegroundColor Green }
function Aviso($t)  { Write-Host $t -ForegroundColor Yellow }
function Falla($t)  {
  Write-Host ''
  Write-Host $t -ForegroundColor Red
  Read-Host 'Presiona Enter para salir' | Out-Null
  exit 1
}
function SiNo($t, $porDefecto = 'S') {
  $r = Read-Host "$t (S/N) [$porDefecto]"
  if (-not $r) { $r = $porDefecto }
  return $r.Trim().ToUpper().StartsWith('S')
}
# Al arrastrar un archivo a la ventana, Windows lo pone entre comillas.
function Ruta($t) { return ($t.Trim().Trim('"').Trim("'")) }

function Copiar-Carpeta($origen, $destino) {
  & robocopy.exe $origen $destino /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { Falla "No se pudo copiar $origen a $destino." }
  # Quita la marca de "descargado de internet" para que Windows no pregunte al abrir.
  Get-ChildItem -LiteralPath $destino -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
}

function Usar-Rutas($destino) {
  $script:Raiz      = $destino
  $script:App       = Join-Path $destino 'app'
  $script:Node      = Join-Path $script:App 'node\node.exe'
  $script:Backend   = Join-Path $script:App 'backend'
  $script:Datos     = Join-Path $destino 'datos'
  $script:Logs      = Join-Path $destino 'logs'
  $script:ConfigEnv = Join-Path $script:Datos 'config.env'
  $script:Scripts   = Join-Path $destino 'scripts'
}

function Prisma([string[]]$a) { return (Ejecutar $Node (@('node_modules\prisma\build\index.js') + $a)) }

# El SQL va por la entrada estándar: PowerShell 5 quita las comillas dobles de los argumentos.
function Consultar($sql, $bd = 'postgres') {
  $antes = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $r = $sql | & $Psql -h localhost -U postgres -d $bd -w -tA -q
  $ErrorActionPreference = $antes
  return $r
}

function Hacer-Backup($archivo) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $archivo) | Out-Null
  $codigo = Ejecutar $PgDump @('-h', 'localhost', '-U', 'postgres', '-w', '--format=custom', '--no-owner', "--file=$archivo", $Base)
  if ($codigo -ne 0) { Falla 'No se pudo sacar la copia de seguridad. No se cambió nada.' }
  Ok "Copia de seguridad guardada en $archivo"
}

function Crear-Accesos($conInicio) {
  $sh = New-Object -ComObject WScript.Shell
  $icono = Join-Path $Scripts 'candys.ico'
  $escritorio = [Environment]::GetFolderPath('Desktop')
  $wscript = "$env:SystemRoot\System32\wscript.exe"
  $accesos = @(
    @{ Ruta = Join-Path $escritorio "Candy's Market.lnk"; Exe = $wscript; Archivo = 'abrir.vbs' },
    @{ Ruta = Join-Path $escritorio "Cerrar Candy's Market.lnk"; Exe = $wscript; Archivo = 'cerrar.vbs' },
    # Con ventana visible: muestra las novedades y el avance.
    @{ Ruta = Join-Path $escritorio "Actualizar Candy's Market.lnk"; Exe = "$env:SystemRoot\System32\cmd.exe"; Archivo = 'actualizar.bat' }
  )
  if ($conInicio) { $accesos += @{ Ruta = Join-Path ([Environment]::GetFolderPath('Startup')) "Candy's Market.lnk"; Exe = $wscript; Archivo = 'abrir.vbs' } }
  foreach ($a in $accesos) {
    $lnk = $sh.CreateShortcut($a.Ruta)
    $lnk.TargetPath = $a.Exe
    if ($a.Exe -eq $wscript) { $lnk.Arguments = "`"$(Join-Path $Scripts $a.Archivo)`"" }
    else { $lnk.Arguments = "/c `"`"$(Join-Path $Scripts $a.Archivo)`"`"" }
    $lnk.WorkingDirectory = $Scripts
    $lnk.IconLocation = "$icono,0"
    $lnk.Save()
  }
}

# Los celulares del inventario entran por 3443 (HTTPS) y 3080 (página del QR).
# Una regla para node.exe evita además el aviso del firewall de Windows.
function Abrir-Firewall {
  $regla = "Candys Market celulares"
  $antes = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & netsh.exe advfirewall firewall show rule name="$regla" | Out-Null
  $existe = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $antes
  if ($existe) { return }
  Write-Host 'Para que los celulares del inventario entren por el WiFi, Windows pedirá permiso de administrador.'
  $cmd = "netsh advfirewall firewall add rule name=`"$regla`" dir=in action=allow program=`"$Node`" protocol=TCP localport=3443,3080 profile=private,domain"
  try {
    $p = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList "/c $cmd" -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($p.ExitCode -eq 0) { Ok 'Firewall listo para los celulares.' } else { Aviso 'No se pudo abrir el firewall; el inventario con celulares no funcionará hasta permitirlo.' }
  } catch {
    Aviso 'Sin permiso de administrador no se abrió el firewall; el inventario con celulares no funcionará hasta permitirlo.'
  }
}

# Agrega a config.env las variables nuevas de cada versión sin tocar las que ya están.
function Completar-Config {
  $lineas = [Collections.Generic.List[string]](Get-Content -LiteralPath $ConfigEnv -Encoding UTF8)
  $faltan = [ordered]@{
    'SECRETOS_DIR' = Join-Path $Datos 'secretos'
    'BACKUP_LOCAL' = Join-Path $Datos 'backups'
    'CERT_RED_DIR' = Join-Path $Datos 'certificados-red'
  }
  $cambio = $false
  foreach ($k in $faltan.Keys) {
    if (-not ($lineas | Where-Object { $_ -match "^\s*$k\s*=" })) { $lineas.Add("$k=`"$($faltan[$k])`""); $cambio = $true }
  }
  if ($cambio) { [IO.File]::WriteAllLines($ConfigEnv, $lineas, (New-Object Text.UTF8Encoding $false)) }
}

function Buscar-Instalacion {
  foreach ($d in @('C:\CandysMarket', 'D:\CandysMarket')) {
    if (Test-Path -LiteralPath (Join-Path $d 'datos\config.env')) { return $d }
  }
  return $null
}

Clear-Host
Write-Host "Instalador de Candy's Market" -ForegroundColor Magenta
Write-Host 'Puedes cerrar esta ventana en cualquier momento antes del final para cancelar.'

# ---------------------------------------------------------------- PostgreSQL
Titulo 'Buscando PostgreSQL'
$psqlExe = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
  Sort-Object { [int](($_.Directory.Parent.Name) -replace '\D', '') } -Descending | Select-Object -First 1
if (-not $psqlExe) {
  Aviso 'Esta PC no tiene PostgreSQL. Instálalo (versión 17) desde la página que se abrirá,'
  Aviso 'anota la contraseña que le pongas al usuario postgres y vuelve a abrir INSTALAR.bat.'
  Start-Process 'https://www.enterprisedb.com/downloads/postgres-postgresql-downloads'
  Falla 'Instalación detenida: falta PostgreSQL.'
}
$PgBin     = $psqlExe.DirectoryName
$PgVersion = [int](($psqlExe.Directory.Parent.Name) -replace '\D', '')
$Psql      = Join-Path $PgBin 'psql.exe'
$PgDump    = Join-Path $PgBin 'pg_dump.exe'
$PgRestore = Join-Path $PgBin 'pg_restore.exe'
Ok "PostgreSQL $PgVersion encontrado en $PgBin"

# ---------------------------------------------------------------- Carpeta
Titulo 'Carpeta de instalación'
$sugerida = Buscar-Instalacion
if (-not $sugerida) { $sugerida = 'C:\CandysMarket' }
if ($Destino) { $destino = $Destino }
elseif ($Actualizar) { $destino = Read-Host "Carpeta del sistema a actualizar [$sugerida]" }
else { $destino = Read-Host "Dónde instalar [$sugerida]" }
if (-not $destino) { $destino = $sugerida }
$destino = Ruta $destino
Usar-Rutas $destino
$hayInstalacion = Test-Path -LiteralPath $ConfigEnv
if ($Actualizar -and -not $hayInstalacion) { Falla "En $destino no hay una instalación de Candy's Market. Para instalar por primera vez usa INSTALAR.bat." }

# ======================================================= Actualizar instalación
if ($hayInstalacion) {
  Aviso "Ya hay una instalación en $destino. Se actualizará el programa y tus datos se quedan igual."
  Aviso 'Antes se guarda una copia de seguridad de la base de datos.'
  if (-not $SinPreguntas -and -not (SiNo '¿Continuar?')) { Falla 'Cancelado. No se cambió nada.' }

  if (Test-Path (Join-Path $Scripts 'detener.ps1')) { & (Join-Path $Scripts 'detener.ps1') -Silencioso }
  $cfg = Cargar-Config $ConfigEnv
  if ($cfg['DATABASE_URL'] -notmatch '^postgresql://[^:]+:([^@]*)@') { Falla 'No entiendo DATABASE_URL en datos\config.env.' }
  $env:PGPASSWORD = [Uri]::UnescapeDataString($matches[1])
  Hacer-Backup (Join-Path $Datos "backups\antes-de-actualizar_$Hoy.backup")

  Titulo 'Copiando el programa'
  Copiar-Carpeta (Join-Path $Paquete 'app') $App
  Copiar-Carpeta (Join-Path $Paquete 'scripts') $Scripts
  Ok 'Programa copiado.'
  Completar-Config
  Cargar-Config $ConfigEnv | Out-Null
  Abrir-Firewall

  Titulo 'Actualizando la base de datos'
  Push-Location $Backend
  $codigo = Prisma @('migrate', 'deploy')
  Pop-Location
  if ($codigo -ne 0) { Falla 'No se pudo actualizar la base de datos. La copia de seguridad de antes está en datos\backups.' }

  Crear-Accesos (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) "Candy's Market.lnk"))
  & (Join-Path $Scripts 'iniciar.ps1')
  Write-Host ''
  Ok 'Listo: el sistema se actualizó y ya está abierto.'
  if (-not $SinPreguntas) { Read-Host 'Presiona Enter para cerrar' | Out-Null }
  exit 0
}

# ======================================================= Instalación nueva
# ---------------------------------------------------------------- Clave
Titulo 'Clave de PostgreSQL'
Write-Host 'Es la contraseña que pusiste al usuario postgres al instalar PostgreSQL.'
$clave = $null
for ($intento = 1; $intento -le 3; $intento++) {
  $segura = Read-Host 'Clave del usuario postgres' -AsSecureString
  $clave = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura))
  $env:PGPASSWORD = $clave
  if ((Consultar 'select 1') -eq '1') { break }
  Aviso 'PostgreSQL no aceptó esa clave (o no está encendido). Revisa Bloq Mayús e intenta otra vez.'
  $clave = $null
}
if (-not $clave) { Falla 'No se pudo entrar a PostgreSQL. No se cambió nada.' }
Ok 'Clave correcta.'

# ---------------------------------------------------------------- Datos
Titulo 'Datos del sistema'
$usarExistente = $false
if ((Consultar "select 1 from pg_database where datname = '$Base'") -eq '1') {
  Aviso "En este PostgreSQL ya existe una base de datos '$Base'."
  Write-Host '  U = usarla tal cual'
  Write-Host '  R = reemplazarla (antes se guarda una copia en datos\backups)'
  $r = (Read-Host 'Elige U o R').Trim().ToUpper()
  if ($r -eq 'U') { $usarExistente = $true }
  elseif ($r -eq 'R') {
    Hacer-Backup (Join-Path $Datos "backups\base-anterior_$Hoy.backup")
    if ((Ejecutar (Join-Path $PgBin 'dropdb.exe') @('-h', 'localhost', '-U', 'postgres', '-w', '--force', $Base)) -ne 0) { Falla 'No se pudo borrar la base anterior.' }
  }
  else { Falla 'Cancelado. No se cambió nada.' }
}

$backup = $null
if (-not $usarExistente) {
  Write-Host ''
  Write-Host 'Para llevar los datos de la otra PC (productos, ventas, caja, usuarios),'
  Write-Host 'arrastra aquí el archivo .backup y presiona Enter.'
  Write-Host 'Para empezar con una base nueva, solo presiona Enter.'
  while ($true) {
    $r = Read-Host 'Archivo de backup'
    if (-not $r) { break }
    $r = Ruta $r
    if (Test-Path -LiteralPath $r -PathType Leaf) { $backup = $r; break }
    Aviso "No encuentro el archivo $r. Intenta otra vez."
  }
  if ($backup -and $PgVersion -lt 17) {
    Aviso "Esta PC tiene PostgreSQL $PgVersion. Si el backup viene de PostgreSQL 17, instala la versión 17 aquí."
  }
}

# ---------------------------------------------------------------- Programa
Titulo 'Copiando el programa'
New-Item -ItemType Directory -Force -Path $Datos, $Logs, (Join-Path $Datos 'backups'), (Join-Path $Datos 'secretos') | Out-Null
Copiar-Carpeta (Join-Path $Paquete 'app') $App
Copiar-Carpeta (Join-Path $Paquete 'scripts') $Scripts
Ok "Programa copiado en $destino"

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$jwt = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$config = @(
  '# Configuración de Candy''s Market en esta PC. No la compartas: tiene la clave de PostgreSQL.',
  "DATABASE_URL=`"postgresql://postgres:$([Uri]::EscapeDataString($clave))@localhost:5432/$Base`?schema=public`"",
  "JWT_SECRET=`"$jwt`"",
  'PORT=3000',
  'HOST=127.0.0.1',
  "SECRETOS_DIR=`"$(Join-Path $Datos 'secretos')`"",
  "BACKUP_LOCAL=`"$(Join-Path $Datos 'backups')`"",
  "CERT_RED_DIR=`"$(Join-Path $Datos 'certificados-red')`""
)
[IO.File]::WriteAllLines($ConfigEnv, $config, (New-Object Text.UTF8Encoding $false))
Cargar-Config $ConfigEnv | Out-Null

# ---------------------------------------------------------------- Base de datos
Titulo 'Preparando la base de datos'
if (-not $usarExistente) {
  if ((Ejecutar (Join-Path $PgBin 'createdb.exe') @('-h', 'localhost', '-U', 'postgres', '-w', '-T', 'template0', '-E', 'UTF8', $Base)) -ne 0) {
    Falla 'No se pudo crear la base de datos.'
  }
  if ($backup) {
    Write-Host 'Restaurando el backup, puede tardar un minuto...'
    Ejecutar $PgRestore @('-h', 'localhost', '-U', 'postgres', '-w', '--no-owner', '--no-privileges', '-d', $Base, $backup) | Out-Null
    if ((Consultar 'select count(*) from "_prisma_migrations"' $Base) -notmatch '^\d+$') {
      Falla 'El backup no se pudo restaurar. Revisa que sea un archivo .backup del sistema.'
    }
    Ok 'Backup restaurado.'
  }
}

Push-Location $Backend
$codigo = Prisma @('migrate', 'deploy')
if ($codigo -ne 0) { Pop-Location; Falla 'No se pudieron crear las tablas.' }
$nueva = (-not $usarExistente) -and (-not $backup)
if ($nueva) {
  if ((Ejecutar $Node @('tools\prisma\seed.js')) -ne 0) { Pop-Location; Falla 'No se pudo crear el usuario admin.' }
  Write-Host ''
  Write-Host 'Si quieres cargar los productos de SysVent, arrastra aquí el archivo stock_produto.csv'
  $csv = Read-Host 'y presiona Enter (o solo Enter para omitir)'
  if ($csv) {
    $csv = Ruta $csv
    if ((Ejecutar $Node @('tools\scripts\importar-sysvent.js', $csv)) -ne 0) { Aviso 'La importación falló; puedes hacerla después desde Productos.' }
  }
}
Pop-Location

# El backup automático usa el pg_dump de esta PC.
Consultar "update `"Configuracion`" set `"pgDumpRuta`" = '$PgDump' where id = 1" $Base | Out-Null
Ok 'Base de datos lista.'

# ---------------------------------------------------------------- Certificado SUNAT
foreach ($origen in @((Join-Path $Carpeta 'secretos'), $(if ($backup) { Join-Path (Split-Path -Parent $backup) 'secretos' }))) {
  if ($origen -and (Test-Path -LiteralPath (Join-Path $origen 'certificado.pfx'))) {
    Copy-Item -Path (Join-Path $origen '*') -Destination (Join-Path $Datos 'secretos') -Force
    Ok 'Certificado SUNAT y clave SOL copiados de la carpeta secretos.'
    break
  }
}

# ---------------------------------------------------------------- Accesos directos
Titulo 'Accesos directos'
Abrir-Firewall
$conInicio = SiNo '¿Quieres que el sistema se abra solo al encender la PC?'
Crear-Accesos $conInicio
Ok 'En el escritorio quedaron "Candy''s Market", "Cerrar Candy''s Market" y "Actualizar Candy''s Market".'

& (Join-Path $Scripts 'iniciar.ps1')

Write-Host ''
Ok 'Listo: Candy''s Market quedó instalado y ya está abierto en el navegador.'
if ($nueva) { Aviso 'Ingresa con admin / admin123 y cambia la clave en Configuración > Mi contraseña.' }
if (-not (Test-Path -LiteralPath (Join-Path $Datos 'secretos\certificado.pfx'))) {
  Aviso 'Falta el certificado SUNAT: cárgalo en Configuración > SUNAT (archivo .pfx, su clave y el usuario SOL).'
}
Aviso 'Revisa la carpeta de Google Drive en Configuración > Backup.'
Read-Host 'Presiona Enter para cerrar' | Out-Null
