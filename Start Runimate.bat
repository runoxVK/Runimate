@echo off
cd /d "%~dp0"
start "" http://localhost:8040
python serve.py 8040
