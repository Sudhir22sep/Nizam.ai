import { MongoClient } from 'mongodb';

const uri = 'mongodb+srv://sudhir22sep_db_user:Sudhir0501@amma-wear.vgvwvpo.mongodb.net/nizam_ai?retryWrites=true&w=majority';
const isLocalDev = process.env['NODE_ENV'] !== 'production';

console.log('Testing MongoDB connection with server options...');
console.log('URI:', uri.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@'));
console.log('isLocalDev:', isLocalDev);

const client = new MongoClient(uri, { 
  serverSelectionTimeoutMS: isLocalDev ? 3000 : 10000,
  connectTimeoutMS: isLocalDev ? 3000 : 10000,
});

async function testConnection() {
  try {
    await client.connect();
    console.log('Connected successfully to MongoDB!');
    const db = client.db();
    console.log('Database:', db.databaseName);
    await client.close();
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    if (err.errorLabels) {
      console.error('Error labels:', err.errorLabels);
    }
    if (err.reason) {
      console.error('Reason:', err.reason);
    }
  } finally {
    await client.close().catch(() => {});
  }
}

testConnection();