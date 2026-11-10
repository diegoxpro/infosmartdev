@echo off
rem Actualiza Candy's Market a la version de este paquete. Tus datos se mantienen.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0paquete\scripts\instalar.ps1" -Actualizar
if errorlevel 1 pause
