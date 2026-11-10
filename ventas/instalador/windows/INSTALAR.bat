@echo off
rem Instala o actualiza Candy's Market. Doble clic para empezar.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0paquete\scripts\instalar.ps1"
if errorlevel 1 pause
