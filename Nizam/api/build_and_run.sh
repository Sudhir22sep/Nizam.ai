#!/usr/bin/env node

// Build the API server using TypeScript
node build_api.js

// Run database migrations
node dist/database/migrate.js

// Start the API server
node dist/index.js

// Open the API URL in the default browser (optional)
// const open = require('open');
// open('http://localhost:3000');