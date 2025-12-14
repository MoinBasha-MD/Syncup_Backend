const bcrypt = require('bcryptjs');

// The stored hash from the database
const storedHash = '$2b$10$3QsfIL8B1byXK3Zv7W2HSOkpffaPxbllXKOVOHAldXPcKC9Av2MXW';

// Test different passwords
const passwords = [
  'Tester@1',
  'tester@1', 
  'Tester1',
  'tester1',
  '12345678',
  'password',
  'Password@1'
];

console.log('Testing password hash...');
console.log('Stored hash:', storedHash);
console.log('');

passwords.forEach(async (password) => {
  const isMatch = await bcrypt.compare(password, storedHash);
  console.log(`Password: "${password}" -> Match: ${isMatch}`);
});
