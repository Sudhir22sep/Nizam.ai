#!/bin/bash
# Systemd backup timer setup script
# This script creates a systemd service and timer for MongoDB backups

# Create the systemd service file
cat > /tmp/nizam-backup.service << 'EOF'
[Unit]
Description=Nizam.ai MongoDB Backup Service
After=network.target

[Service]
Type=oneshot
User=root
Group=codespace
ExecStart=/workspaces/Nizam.ai/scripts/mongodb_backup.sh
StandardOutput=journal
StandardError=journal
WorkingDirectory=/workspaces/Nizam.ai

[Install]
WantedBy=multi-user.target
EOF

# Create the systemd timer file
cat > /tmp/nizam-backup.timer << 'EOF'
[Unit]
Description=Daily Nizam.ai MongoDB Backup
Requires=nizam-backup.service

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

echo "Backup service and timer files created in /tmp/"
echo "To install these as systemd services, run:"
echo "  sudo cp /tmp/nizam-backup.service /etc/systemd/system/"
echo "  sudo cp /tmp/nizam-backup.timer /etc/systemd/system/"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable nizam-backup.timer"
echo "  sudo systemctl start nizam-backup.timer"