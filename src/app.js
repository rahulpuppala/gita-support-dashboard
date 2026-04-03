require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { migrate } = require('./database/migrate');
const { seed } = require('./database/seed');
const whatsappService = require('./services/whatsappService');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/api/dashboard');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', whatsapp: whatsappService.isConnected() ? 'connected' : 'disconnected' });
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

app.use(errorHandler);

io.on('connection', (socket) => {
  logger.info(`Dashboard connected: ${socket.id}`);
  socket.on('disconnect', () => logger.info(`Dashboard disconnected: ${socket.id}`));
});

async function start() {
  try {
    logger.info('Running migrations...');
    migrate();
    seed();

    server.listen(PORT, () => logger.info(`Dashboard: http://localhost:${PORT}`));

    logger.info('Starting WhatsApp client...');
    await whatsappService.initialize(io);

    logger.info('Gita Support Tool is running');
  } catch (err) {
    logger.error(`Failed to start: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  const { closeDb } = require('./config/database');
  closeDb();
  server.close();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason));

start();
