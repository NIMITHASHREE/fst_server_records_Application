const dotenv = require('dotenv');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { validateEnv } = require('./config/env');
const { createApp } = require('./app');

dotenv.config();

async function startServer() {
  const config = validateEnv(process.env);
  await connectDB(config.mongoUri);

  const server = createApp(config).listen(config.port, '127.0.0.1', () => {
    console.log(`Server running on port ${config.port}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; shutting down`);
    server.close(async () => {
      await mongoose.connection.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Server startup failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { startServer };
