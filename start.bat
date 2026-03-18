@echo off
title Inbox App - Dev
cd /d "%~dp0"

echo Verificando Node/npm...
where npm >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERRO] npm nao encontrado. Instale o Node.js em https://nodejs.org e reinicie o terminal.
    pause
    exit /b 1
)

echo.
echo Iniciando backend (porta 3001) e frontend (porta 5173)...
echo Acesse: http://localhost:5173/inbox
echo Para parar: feche esta janela ou pressione Ctrl+C
echo.

call npm run dev:all

pause
