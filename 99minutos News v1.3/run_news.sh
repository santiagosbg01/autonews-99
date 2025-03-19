#!/bin/bash

# Change to the project directory
cd "/Users/santiago/Library/CloudStorage/Dropbox/Mac/Desktop/Proyectos Cursor/99minutos News v1.3"

# Activate virtual environment
source .venv/bin/activate

# Run the main program
python3 main.py

# Log the execution
echo "News aggregator run completed at $(date)" >> logs/scheduled_runs.log 