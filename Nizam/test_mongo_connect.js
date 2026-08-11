import { MongoClient } from 'mongodb';

const uri = 'mongodb+srv://sudhir22sep_db_user:Sudhir0501@amma-wear.vgvwvpo.mongodb.net/ammawears_dev?retryWrites=true&w=majority';

console.log('Testing MongoDB connection...');
console.log('URI:', uri.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@'));

const client = new MongoClient(uri);

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