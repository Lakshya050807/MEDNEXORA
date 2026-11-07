import mongoose from 'mongoose';

export function getHealth(_request, response) {
  const databaseReady = mongoose.connection.readyState === 1;
  response.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? 'ok' : 'unavailable',
    service: 'nursing-learning-api',
    timestamp: new Date().toISOString(),
  });
}

