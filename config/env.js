const REQUIRED = [
  'MONGO_URI',
  'JWT_SECRET',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'CLIENT_ORIGINS',
];

function validateEnv(env = process.env) {
  for (const name of REQUIRED) {
    if (!env[name] || !env[name].trim()) {
      throw new Error(`${name} is required`);
    }
  }

  if (env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters');
  }
  if (env.ADMIN_USERNAME.trim().toLowerCase() === 'admin') {
    throw new Error('ADMIN_USERNAME must not use the default admin value');
  }
  if (env.ADMIN_PASSWORD.length < 12 || env.ADMIN_PASSWORD === 'admin123') {
    throw new Error('ADMIN_PASSWORD must contain at least 12 characters and must not use a default value');
  }

  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const clientOrigins = env.CLIENT_ORIGINS.split(',').map((origin) => {
    const normalized = origin.trim().replace(/\/$/, '');
    let url;
    try {
      url = new URL(normalized);
    } catch {
      throw new Error(`CLIENT_ORIGINS contains an invalid URL: ${origin.trim()}`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== normalized) {
      throw new Error(`CLIENT_ORIGINS must contain only HTTP(S) origins: ${origin.trim()}`);
    }
    return normalized;
  });

  if (clientOrigins.length === 0) {
    throw new Error('CLIENT_ORIGINS must contain at least one origin');
  }

  return {
    nodeEnv: env.NODE_ENV || 'development',
    port,
    mongoUri: env.MONGO_URI,
    jwtSecret: env.JWT_SECRET,
    adminUsername: env.ADMIN_USERNAME.trim(),
    adminPassword: env.ADMIN_PASSWORD,
    clientOrigins: [...new Set(clientOrigins)],
    uploadDir: env.UPLOAD_DIR || './uploads',
  };
}

module.exports = { validateEnv };
