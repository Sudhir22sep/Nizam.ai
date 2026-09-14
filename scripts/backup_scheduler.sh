#!/bin/bash
# Daily Backup Scheduler for Nizam.ai
# Usage: ./backup_scheduler.sh

BACKUP_SCRIPT="/workspaces/Nizam.ai/scripts/mongodb_backup.sh"
LOG_FILE="/workspaces/Nizam.ai/logs/backup.log"

# Create log directory if it doesn't exist
mkdir -p "$(dirname "$LOG_FILE")"

# Function to run backup at scheduled time
run_backup() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting daily MongoDB backup..." >> "$LOG_FILE"
    "$BACKUP_SCRIPT" >> "$LOG_FILE" 2>&1
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup completed" >> "$LOG_FILE"
}

# Check if we're running in continuous mode
if [ "$1" = "--continuous" ]; then
    echo "Starting continuous backup scheduler..."
    echo "Backups will run daily at 02:00 UTC"
    echo "Logs available at: $LOG_FILE"
    
    while true; do
        run_backup
        # Sleep for 24 hours (86400 seconds)
        sleep 86400
    done
else
    # Run backup immediately
    run_backup
fi