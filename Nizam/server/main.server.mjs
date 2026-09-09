// Environment variable configuration loaded from .env file
// Required for JWT authentication, database connectivity, and service integrations

// Authentication
const JWT_SECRET = process.env.JWT_SECRET;
const APP_URL = process.env.APP_URL;
const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Database Configuration
const MONGODB_URI = process.env.MONGODB_URI;

// Payment Integration (Razorpay)
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// Optional Services
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SES_REGION = process.env.SES_REGION;
const SES_VERIFIED_SENDER = process.env.SES_VERIFIED_SENDER;

// Security Settings
const SECURE_PASSWORD_RESET = process.env.SECURE_PASSWORD_RESET;
const CSP_POLICY = process.env.CSP_POLICY;

// Logging
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Health Check Endpoint
const HEALTH_CHECK = '/health';

console.log('Server Initialized with following configuration:');
console.log('- JWT_SECRET:', JWT_SECRET ? '✓ Set' : '✗ Missing');
console.log('- APP_URL:', APP_URL ? '✓ Set' : '✗ Missing');
console.log('- MONGODB_URI:', MONGODB_URI ? '✓ Set' : '✗ Missing');
console.log('- RAZORPAY_KEY_ID:', RAZORPAY_KEY_ID ? '✓ Set' : '✗ Missing');
console.log('- PORT:', PORT);
console.log('- NODE_ENV:', NODE_ENV);
console.log('- CSP_POLICY:', CSP_POLICY ? '✓ Set' : '✗ Missing');
