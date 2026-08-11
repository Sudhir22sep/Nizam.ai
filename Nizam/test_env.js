import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('__dirname:', __dirname);
console.log('process.cwd():', process.cwd());

dotenv.config({ path: resolve(process.cwd(), '.env'), override: true });

console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('MONGODB_URI:', process.env.MONGODB_URI);