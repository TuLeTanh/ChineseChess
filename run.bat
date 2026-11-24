@echo off
cd /d "%~dp0"
echo Starting Chinese Chess server (with Pikafish bridge) at http://localhost:8000
echo Press Ctrl+C to stop.
start "" "http://localhost:8000"
python tools\server.py --port 8000
