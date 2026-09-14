// Environment Variables Monitoring Script
// This script checks and logs the status of critical environment variables

const fs = require('fs');
const path = require('path');

function checkEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found at:', envPath);
    return false;
  }
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envLines = envContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  
  console.log('🔍 Environment Variables Check:');
  console.log('='.repeat(50));
  
  const criticalVars = [
    'JWT_SECRET',
    'APP_URL', 
    'PORT',
    'NODE_ENV',
    'MONGODB_URI',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET'
  ];
  
  let allSet = true;
  
  criticalVars.forEach(varName => {
    const found = envLines.some(line => line.startsWith(`${varName}=`));
    const status = found ? '✓ SET' : '✗ MISSING';
    console.log(`${varName.padEnd(25)}: ${status}`);
    if (!found) allSet = false;
  });
  
  console.log('='.repeat(50));
  
  if (allSet) {
    console.log('✅ All critical environment variables are set');
    return true;
  } else {
    console.error('❌ Some critical environment variables are missing');
    return false;
  }
}

function checkMongoDBConnection() {
  console.log('\n🔌 MongoDB Connection Check:');
  console.log('='.repeat(50));
  
  try {
    // Load environment variables
    require('dotenv').config({ path: path.join(__dirname, '.env') });
    
    const { MongoClient } = require('mongodb');
    const uri = process.env.MONGODB_URI;
    
    if (!uri) {
      console.error('❌ MONGODB_URI not found in environment');
      return false;
    }
    
    console.log(`Connecting to: ${uri.replace(/:[^:@]+@/, ':***@')}`); // Hide password
    
    // Test connection
    const client = new MongoClient(uri);
    
    // Set timeout for connection attempt
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout')), 5000)
    );
    
    const connectionPromise = client.connect();
    
    return Promise.race([connectionPromise, timeoutPromise])
      .then(client => {
        console.log('✅ MongoDB connection successful');
        
        // Test database access
        const db = client.db();
        console.log(`📊 Connected to database: ${db.databaseName}`);
        
        // List collections
        return db.listCollections().toArray()
          .then(collections => {
            console.log(`📋 Collections (${collections.length}):`);
            collections.forEach(coll => {
              console.log(`  - ${coll.name}`);
            });
            
            client.close();
            return true;
          });
      })
      .catch(error => {
        console.error('❌ MongoDB connection failed:');
        console.error(`   ${error.message}`);
        if (error.name === 'MongoServerError') {
          console.error(`   Error code: ${error.code}`);
        }
        return false;
      });
  } catch (error) {
    console.error('❌ Failed to initialize MongoDB client:');
    console.error(`   ${error.message}`);
    return false;
  }
}

function runMonitoring() {
  console.log('🚀 Starting Environment & Database Monitoring');
  console.log('='.repeat(60));
  
  const envOk = checkEnvFile();
  const dbOk = checkMongoDBConnection();
  
  console.log('\n📊 Summary:');
  console.log('='.repeat(60));
  console.log(`Environment Variables: ${envOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`MongoDB Connection:    ${dbOk ? '✅ PASS' : '❌ FAIL'}`);
  
  const overallStatus = envOk && dbOk;
  console.log(`\nOverall Status: ${overallStatus ? '✅ HEALTHY' : '❌ ISSUES DETECTED'}`);
  
  // Log to file
  const logEntry = {
    timestamp: new Date().toISOString(),
    envCheck: envOk,
    dbCheck: dbOk,
    overall: overallStatus
  };
  
  const logPath = path.join(__dirname, 'monitoring.log');
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
  
  return overallStatus;
}

// Run if executed directly
if (require.main === module) {
  const isHealthy = runMonitoring();
  process.exit(isHealthy ? 0 : 1);
}

module.exports = { checkEnvFile, checkMongoDBConnection, runMonitoring };