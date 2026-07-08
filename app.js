const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const path = require('path');
const validateObjectIds = require('./middleware/validateObjectId');

function createApp(config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.clientOrigins.includes(origin.replace(/\/$/, ''))) {
          return callback(null, true);
        }
        const error = new Error('Origin not allowed by CORS');
        error.status = 403;
        return callback(error);
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: config.nodeEnv === 'test' ? 1000 : 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static(path.resolve(config.uploadDir)));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/classes', require('./routes/classes'));
  app.use('/api/classes/:classId', validateObjectIds('classId'), require('./routes/students'));
  app.use('/api/classes/:classId/attendance', validateObjectIds('classId'), require('./routes/attendance'));
  app.use('/api/admin', require('./routes/admin'));

  app.get('/', (_req, res) => {
    res.json({ message: 'FST Project API is running' });
  });

  app.use((_req, res) => {
    res.status(404).json({ message: 'Route not found' });
  });

  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ message: 'Request body is too large' });
    }
    if (error.name === 'MulterError') {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ message: error.message });
    }
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    return res.status(status).json({
      message: status >= 500 ? 'Server error' : error.message,
    });
  });

  return app;
}

module.exports = { createApp };
