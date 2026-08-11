import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('__dirname:', __dirname);
console.log('process.cwd():', process.cwd());
console.log('NODE_ENV from process.env:', JSON.stringify(process.env.NODE_ENV));
console.log('NODE_ENV (typeof):', typeof process.env.NODE_ENV);