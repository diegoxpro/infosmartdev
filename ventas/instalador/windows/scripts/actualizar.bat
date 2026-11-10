@echo off
rem Actualiza Candy's Market con lo ultimo de GitHub. Necesita internet.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar-github.ps1" %*
