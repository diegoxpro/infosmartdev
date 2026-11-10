# Actualiza Candy's Market con lo último de GitHub (rama main).
# Descarga el código, lo compila en una carpeta aparte y recién al final
# reemplaza el programa con instalar.ps1 -Actualizar (que saca un backup antes).
# Si algo falla o se corta a la mitad, el programa instalado queda igual.
param([switch]$Forzar)
. (Join-Path $PSScriptRoot 'comun.ps1')

$Repo     = 'diegoxpro/sysventcandys'
$Rama     = 'main'
$Trabajo  = Join-Path $Raiz 'actualizacion'
$Version  = Join-Path $App 'version.txt'
$NodeDir  = Join-Path $App 'node'
$NpmCli   = Join-Path $NodeDir 'node_modules\npm\bin\npm-cli.js'

function Titulo($t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Magenta }
function Ok($t)     { Write-Host $t -ForegroundColor Green }
function Aviso($t)  { Write-Host $t -ForegroundColor Yellow }
function Falla($t)  {
  Write-Host ''
  Write-Host $t -ForegroundColor Red
  Write-Host 'El sistema instalado no se tocó.' -ForegroundColor Red
  Read-Host 'Presiona Enter para salir' | Out-Null
  exit 1
}
function Npm([string[]]$a) { return (Ejecutar $Node (@($NpmCli, '--no-audit', '--no-fund', '--loglevel=error') + $a)) }

Clear-Host
Write-Host "Actualizar Candy's Market desde GitHub" -ForegroundColor Magenta

if (-not (Test-Path -LiteralPath $ConfigEnv)) { Falla "No encuentro la instalación en $Raiz." }
if (-not (Test-Path -LiteralPath $NpmCli)) { Falla 'A esta instalación le falta npm. Actualízala una vez con ACTUALIZAR.bat del paquete más reciente.' }

# PowerShell 5 usa TLS 1.0 por defecto; GitHub pide 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

# ---------------------------------------------------------------- Novedades
Titulo 'Buscando novedades'
try { $ultimo = Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/$Repo/commits/$Rama" }
catch { Falla 'No se pudo entrar a GitHub. Revisa el internet e intenta otra vez.' }
$nuevo = $ultimo.sha
$actual = $null
if (Test-Path -LiteralPath $Version) { $actual = (Get-Content -LiteralPath $Version | Select-Object -First 1).Trim() }

if ($actual -and $nuevo.StartsWith($actual) -and -not $Forzar) {
  Ok "El sistema ya está al día (versión $actual)."
  Read-Host 'Presiona Enter para cerrar' | Out-Null
  exit 0
}

if ($actual) {
  try {
    $cmp = Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/$Repo/compare/$actual...$nuevo"
    Write-Host 'Cambios nuevos:'
    foreach ($c in $cmp.commits) {
      $titulo = ($c.commit.message -split "`n")[0]
      if ($titulo -notmatch '^Merge ') { Write-Host "  - $titulo" }
    }
  } catch { Write-Host "Hay una versión nueva ($($nuevo.Substring(0, 7)))." }
} else {
  Write-Host "Se instalará la versión $($nuevo.Substring(0, 7)) de GitHub."
}
Write-Host ''
Aviso 'Cierra la caja antes de seguir: el sistema se apaga unos minutos mientras se actualiza.'
$r = Read-Host '¿Actualizar ahora? (S/N) [S]'
if ($r -and -not $r.Trim().ToUpper().StartsWith('S')) { Write-Host 'Cancelado.'; exit 0 }

# ---------------------------------------------------------------- Descarga
Titulo 'Descargando de GitHub'
if (Test-Path -LiteralPath $Trabajo) { Remove-Item -LiteralPath $Trabajo -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Trabajo | Out-Null
$zip = Join-Path $Trabajo 'codigo.zip'
try { Invoke-WebRequest -UseBasicParsing "https://codeload.github.com/$Repo/zip/$nuevo" -OutFile $zip }
catch { Falla 'No se pudo descargar el código de GitHub.' }
Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $Trabajo 'codigo') -Force
$src = Get-ChildItem -LiteralPath (Join-Path $Trabajo 'codigo') -Directory | Select-Object -First 1
if (-not $src -or -not (Test-Path (Join-Path $src.FullName 'backend\package.json'))) { Falla 'El código descargado no tiene la forma esperada.' }
# Nombre corto: con el sha completo las rutas de node_modules pasan el límite de Windows.
$src = (Rename-Item -LiteralPath $src.FullName -NewName 'src' -PassThru).FullName
Ok 'Código descargado.'

# npm necesita node en el PATH para correr los scripts de compilación.
$env:PATH = "$NodeDir;$env:PATH"
$env:CHECKPOINT_DISABLE = '1'
$env:PRISMA_HIDE_UPDATE_MESSAGE = '1'

# ---------------------------------------------------------------- Backend
Titulo 'Compilando el sistema (puede tardar unos minutos)'
$b = Join-Path $src 'backend'
Push-Location $b
# El CLI de Prisma pasa a dependencias para que quede después de podar (migrate deploy).
& $Node -e "const f='package.json',p=require('./'+f);p.dependencies.prisma=p.devDependencies.prisma;require('fs').writeFileSync(f,JSON.stringify(p,null,2))"
if ((Npm @('install')) -ne 0) { Pop-Location; Falla 'No se pudieron descargar las librerías del backend.' }
if ((Ejecutar $Node @('node_modules\prisma\build\index.js', 'generate')) -ne 0) { Pop-Location; Falla 'Falló prisma generate.' }
if ((Npm @('run', 'build')) -ne 0) { Pop-Location; Falla 'No se pudo compilar el backend.' }
$tools = Join-Path $Trabajo 'tools'
if ((Ejecutar $Node @('node_modules\typescript\bin\tsc', '-p', 'tsconfig.json', '--outDir', $tools, '--incremental', 'false', '--sourceMap', 'false')) -ne 0) { Pop-Location; Falla 'No se pudieron compilar los scripts de la base.' }
if ((Npm @('prune', '--omit=dev')) -ne 0) { Pop-Location; Falla 'No se pudieron limpiar las librerías del backend.' }
if ((Ejecutar $Node @('node_modules\prisma\build\index.js', 'generate')) -ne 0) { Pop-Location; Falla 'Falló prisma generate.' }
Pop-Location
Ok 'Backend compilado.'

# ---------------------------------------------------------------- Frontend
$f = Join-Path $src 'frontend'
Push-Location $f
if ((Npm @('ci')) -ne 0) { Pop-Location; Falla 'No se pudieron descargar las librerías de la pantalla.' }
if ((Npm @('run', 'build')) -ne 0) { Pop-Location; Falla 'No se pudo compilar la pantalla.' }
Pop-Location
Ok 'Pantalla compilada.'

# ---------------------------------------------------------------- Paquete
Titulo 'Armando el paquete'
$paq = Join-Path $Trabajo 'paquete'
$nApp = Join-Path $paq 'app'
$nB = Join-Path $nApp 'backend'
New-Item -ItemType Directory -Force -Path (Join-Path $nB 'tools\prisma'), (Join-Path $nB 'tools\scripts'), (Join-Path $nB 'prisma'), (Join-Path $nApp 'frontend') | Out-Null
foreach ($d in @('dist', 'node_modules')) {
  & robocopy.exe (Join-Path $b $d) (Join-Path $nB $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Falla "No se pudo copiar $d." }
}
Copy-Item (Join-Path $tools 'prisma\seed.js') (Join-Path $nB 'tools\prisma\')
Copy-Item (Join-Path $tools 'scripts\importar-sysvent.js') (Join-Path $nB 'tools\scripts\')
Copy-Item (Join-Path $b 'prisma\schema.prisma') (Join-Path $nB 'prisma\')
Copy-Item (Join-Path $b 'prisma\migrations') (Join-Path $nB 'prisma\') -Recurse
Copy-Item (Join-Path $b 'package.json') $nB
Copy-Item (Join-Path $f 'dist') (Join-Path $nApp 'frontend\') -Recurse
& robocopy.exe $NodeDir (Join-Path $nApp 'node') /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $src 'instalador\windows\scripts') (Join-Path $paq 'scripts') -Recurse
# En GitHub los scripts vienen sin BOM: PowerShell 5 leería mal las tildes.
$conBom = New-Object Text.UTF8Encoding $true
Get-ChildItem -LiteralPath (Join-Path $paq 'scripts') -File | Where-Object { $_.Extension -in '.ps1', '.bat', '.vbs' } | ForEach-Object {
  $texto = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8) -replace "`r?`n", "`r`n"
  if ($_.Extension -eq '.ps1') { [IO.File]::WriteAllText($_.FullName, $texto, $conBom) }
  else { [IO.File]::WriteAllText($_.FullName, $texto, [Text.Encoding]::ASCII) }
}
Set-Content -LiteralPath (Join-Path $nApp 'version.txt') -Value $nuevo.Substring(0, 7)
Ok 'Paquete listo.'

# ---------------------------------------------------------------- Instalar
# El instalador nuevo apaga el sistema, saca el backup, copia y migra.
& (Join-Path $paq 'scripts\instalar.ps1') -Actualizar -Destino $Raiz -SinPreguntas
if ($LASTEXITCODE -ne 0) { Read-Host 'Presiona Enter para salir' | Out-Null; exit 1 }

Remove-Item -LiteralPath $Trabajo -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ''
Ok "Listo: Candy's Market quedó en la versión $($nuevo.Substring(0, 7))."
Read-Host 'Presiona Enter para cerrar' | Out-Null
