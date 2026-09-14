#!/usr/bin/env node
/**
 * Removes data created by the automated test scripts (scripts/*-test.sh) from
 * the database. Test records are identified by their email prefix:
 *   smoketest. / verify. / wish.
 *
 * Usage (run from the Nizam/ directory):
 *   node scripts/cleanup-test-data.cjs            # dry run, prints what it would delete
 *   node scripts/cleanup-test-data.cjs --apply    # actually delete
 *
 * Safety: refuses to run against a database whose name does not contain
 * "dev", "test" or "int" unless --allow-any-db is also passed.
 */
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const APPLY = process.argv.includes('--apply');
const ALLOW_ANY_DB = process.argv.includes('--allow-any-db');
const TEST_EMAIL = /^(smoketest|verify|wish)\./i;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set (checked the environment and Nizam/.env)');
    process.exit(1);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db();
  const dbName = db.databaseName;

  if (!ALLOW_ANY_DB && !/dev|test|int/i.test(dbName)) {
    console.error(`Refusing to run against database "${dbName}". Pass --allow-any-db to override.`);
    await client.close();
    process.exit(1);
  }

  console.log(`Database: ${dbName}`);
  console.log(`Mode: ${APPLY ? 'APPLY (deleting)' : 'DRY RUN (nothing will be deleted)'}`);

  const users = db.collection('users');
  const orders = db.collection('orders');
  const contacts = db.collection('contacts');
  const wishlists = db.collection('wishlists');

  const testUsers = await users.find({ email: TEST_EMAIL }).toArray();
  const userIds = testUsers.map((u) => u._id);

  const filter = { email: TEST_EMAIL };
  const counts = {
    users: testUsers.length,
    orders: await orders.countDocuments(filter),
    contacts: await contacts.countDocuments(filter),
    wishlists: await wishlists.countDocuments({ userId: { $in: userIds } }),
  };

  console.log('Matched test records:', counts);
  console.log('Emails:', testUsers.map((u) => u.email).join(', ') || '(none)');

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to delete these records.');
    await client.close();
    return;
  }

  const deleted = {
    users: (await users.deleteMany(filter)).deletedCount,
    orders: (await orders.deleteMany(filter)).deletedCount,
    contacts: (await contacts.deleteMany(filter)).deletedCount,
    wishlists: (await wishlists.deleteMany({ userId: { $in: userIds } })).deletedCount,
  };

  console.log('Deleted:', deleted);
  await client.close();
}

main().catch((error) => {
  console.error('Cleanup failed:', error);
  process.exit(1);
});