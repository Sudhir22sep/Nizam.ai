#!/bin/bash
cd /workspaces/Nizam.ai/Nizam
export PORT=4000
node dist/Nizam/server/main.server.mjs > server.log 2>&1 &
echo $! > server.pid
