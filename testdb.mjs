import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.argv[2];
if (!DATABASE_URL) {
  console.error('Usage: node testdb.mjs <DATABASE_URL>');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

try {
  const users = await sql`SELECT email, left(password_hash, 7) as hash_start FROM users LIMIT 10`;
  console.log('Total users found:', users.length);
  console.log('Users:', JSON.stringify(users, null, 2));
} catch (err) {
  console.error('DB ERROR:', err.message);
}
