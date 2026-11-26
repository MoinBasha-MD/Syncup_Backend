const bcrypt = require('bcryptjs');

// Shared password for viewing the waitlist on the public site. Stored as a
// one-way bcrypt hash, never the plaintext. Rotate it by replacing the hash:
//   node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" 'new-password'
const WAITLIST_ACCESS_HASH = '$2b$12$ANiSHM0QQMgIQS6vXm5/Y.Ggrm4xRZbAa.HMVaKkjJQuDcdaUgGhC';

// bcrypt only reads the first 72 bytes; cap input so oversized bodies are cheap to reject.
const verifyWaitlistPassword = (password) =>
  typeof password === 'string' && password.length > 0 && password.length <= 128
    ? bcrypt.compare(password, WAITLIST_ACCESS_HASH)
    : Promise.resolve(false);

module.exports = { WAITLIST_ACCESS_HASH, verifyWaitlistPassword };
