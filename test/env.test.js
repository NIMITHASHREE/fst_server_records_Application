const test = require('node:test');
const assert = require('node:assert/strict');

const { validateEnv } = require('../config/env');

const validEnv = {
  NODE_ENV: 'production',
  PORT: '5000',
  MONGO_URI: 'mongodb+srv://user:password@example.mongodb.net/fst',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
  ADMIN_USERNAME: 'records-admin',
  ADMIN_PASSWORD: 'a-strong-admin-password',
  CLIENT_ORIGINS: 'https://fst.vercel.app, http://localhost:5173/',
  UPLOAD_DIR: './uploads',
};

test('rejects missing required environment variables', () => {
  assert.throws(() => validateEnv({}), /MONGO_URI/);
});

test('rejects weak secrets and default admin credentials', () => {
  assert.throws(
    () => validateEnv({ ...validEnv, JWT_SECRET: 'short' }),
    /JWT_SECRET/,
  );
  assert.throws(
    () => validateEnv({ ...validEnv, ADMIN_USERNAME: 'admin' }),
    /ADMIN_USERNAME/,
  );
  assert.throws(
    () => validateEnv({ ...validEnv, ADMIN_PASSWORD: 'admin123' }),
    /ADMIN_PASSWORD/,
  );
});

test('normalizes valid environment configuration', () => {
  assert.deepEqual(validateEnv(validEnv), {
    nodeEnv: 'production',
    port: 5000,
    mongoUri: validEnv.MONGO_URI,
    jwtSecret: validEnv.JWT_SECRET,
    adminUsername: 'records-admin',
    adminPassword: 'a-strong-admin-password',
    clientOrigins: ['https://fst.vercel.app', 'http://localhost:5173'],
    uploadDir: './uploads',
  });
});

test('rejects malformed origins and ports', () => {
  assert.throws(
    () => validateEnv({ ...validEnv, CLIENT_ORIGINS: 'fst.vercel.app' }),
    /CLIENT_ORIGINS/,
  );
  assert.throws(
    () => validateEnv({ ...validEnv, PORT: '70000' }),
    /PORT/,
  );
});
