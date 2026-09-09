const fs = require('fs');
const path = require('path');

// Set working directory to project root
const projectRoot = '/workspaces/Nizam.ai';
process.chdir(projectRoot);

function checkEnvFile() {
  const envPath = path.join(projectRoot, '.env');