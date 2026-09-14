#!/bin/bash
# MongoDB Backup Script for Nizam.ai
# saves backup to workspace/backups with date-stamp and retention policy

# Configuration
DB_URI="mongodb+srv://sudhir22sep_db_user:Sudhir0501@amma-wear.vgvwvpo.mongodb.net"
BACKUP_DIR="/workspaces/Nizam.ai/backups"
RETENTION_DAYS=30

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Generate timestamped backup directory name
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_PATH="$BACKUP_DIR/backup_$TIMESTAMP"

# Perform MongoDB dump
echo "[$(date)] Starting MongoDB backup..."
mongodump --uri "$DB_URI" --out "$BACKUP_PATH"

# Create compressed archive
ARCHIVE_NAME="nizam_backup_$TIMESTAMP.tar.gz"
echo "[$(date)] Creating compressed archive: $ARCHIVE_NAME"
tar -czf "$BACKUP_DIR/$ARCHIVE_NAME" -C "$BACKUP_DIR" "$BACKUP_PATH"

# Clean up temporary backup directory
rm -rf "$BACKUP_PATH"

# Remove backups older than retention period
echo "[$(date)] Cleaning up old backups ($RETENTION_DAYS days retention)..."
find "$BACKUP_DIR" -name "nizam_backup_*.tar.gz" -mtime +$RETENTION_DAYS -delete

# Log completion
echo "[$(date)] Backup completed: $ARCHIVE_NAME"
