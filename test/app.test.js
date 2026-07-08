const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../app');

const config = {
  nodeEnv: 'test',
  clientOrigins: ['https://fst.vercel.app'],
  uploadDir: './uploads-test',
};

async function withServer(run) {
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('health endpoint returns service status and security headers', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: 'FST Project API is running' });
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });
});

test('CORS accepts configured origins and rejects all others', async () => {
  await withServer(async (baseUrl) => {
    const accepted = await fetch(`${baseUrl}/`, {
      headers: { Origin: 'https://fst.vercel.app' },
    });
    assert.equal(accepted.headers.get('access-control-allow-origin'), 'https://fst.vercel.app');

    const rejected = await fetch(`${baseUrl}/`, {
      headers: { Origin: 'https://attacker.example' },
    });
    assert.equal(rejected.status, 403);
    assert.deepEqual(await rejected.json(), { message: 'Origin not allowed by CORS' });
  });
});

test('unknown routes return a JSON 404', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { message: 'Route not found' });
  });
});

test('JSON bodies larger than one MiB are rejected', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'x'.repeat(1024 * 1024), password: 'x' }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { message: 'Request body is too large' });
  });
});
