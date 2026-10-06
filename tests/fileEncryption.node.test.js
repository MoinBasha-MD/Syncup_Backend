const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getInstance } = require('../utils/fileEncryption');

test('file encryption awaits the derived key and rejects tampered GCM data', async (t) => {
  const encryption = getInstance();
  const originalGetMasterKey = encryption.getMasterKey;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'syncup-file-encryption-'));
  const plaintextPath = path.join(directory, 'input.txt');
  const encryptedPath = path.join(directory, 'encrypted.bin');
  const decryptedPath = path.join(directory, 'decrypted.txt');
  const tamperedTagPath = path.join(directory, 'tampered-tag.bin');
  const tamperedCipherPath = path.join(directory, 'tampered-cipher.bin');

  t.after(async () => {
    encryption.getMasterKey = originalGetMasterKey;
    await fs.rm(directory, { recursive: true, force: true });
  });

  encryption.getMasterKey = async () => Buffer.from('offline-fixed-master-key');
  await fs.writeFile(plaintextPath, Buffer.from('offline encrypted test payload'));

  const result = await encryption.encryptFile(plaintextPath, encryptedPath);
  assert.equal(result.success, true);
  const decrypted = await encryption.decryptFile(encryptedPath, decryptedPath);
  assert.deepEqual(decrypted, Buffer.from('offline encrypted test payload'));
  assert.deepEqual(await fs.readFile(decryptedPath), decrypted);

  const encrypted = await fs.readFile(encryptedPath);
  const tagTampered = Buffer.from(encrypted);
  tagTampered[encryption.saltLength + encryption.ivLength] ^= 1;
  await fs.writeFile(tamperedTagPath, tagTampered);
  await assert.rejects(encryption.decryptFile(tamperedTagPath));

  const cipherTampered = Buffer.from(encrypted);
  cipherTampered[encryption.saltLength + encryption.ivLength + encryption.authTagLength] ^= 1;
  await fs.writeFile(tamperedCipherPath, cipherTampered);
  await assert.rejects(encryption.decryptFile(tamperedCipherPath));
});
