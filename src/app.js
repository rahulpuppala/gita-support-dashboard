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
const { loadAllFiles } = require('./services/knowledgeBase');
const { setSocketIO } = require('./services/responseService');
const whatsappService = require('./services/whatsappService');

// Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/api/dashboard');
const chatsRoutes = require('./routes/api/chats');
const actionsRoutes = require('./routes/api/actions');
const knowledgeRoutes = require('./routes/api/knowledge');
const emailWebhookRoutes = require('./routes/api/emailWebhook');
const contextRoutes = require('./routes/api/context');
const simulatorRoutes = require('./routes/api/simulator');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/chats', chatsRoutes);
app.use('/api/actions', actionsRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/email', emailWebhookRoutes);
app.use('/api/context', contextRoutes);
app.use('/api/simulator', simulatorRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    whatsapp: whatsappService.isConnected() ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Serve dashboard for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// Error handler
app.use(errorHandler);

// Socket.IO connection
io.on('connection', (socket) => {
  logger.info(`Dashboard client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    logger.info(`Dashboard client disconnected: ${socket.id}`);
  });
});

// Share Socket.IO with services
setSocketIO(io);
emailWebhookRoutes.setSocketIO(io);
simulatorRoutes.setSocketIO(io);

async function start() {
  try {
    // 1. Run database migration
    logger.info('Running database migrations...');
    migrate();

    // 2. Seed default data if needed
    seed();

    // 3. Load knowledge base from DOCX files
    logger.info('Loading knowledge base...');
    await loadAllFiles();

    // 4. Start HTTP server
    server.listen(PORT, () => {
      logger.info(`Dashboard server running on http://localhost:${PORT}`);
    });

    // 5. Initialize WhatsApp client
    logger.info('Starting WhatsApp client...');
    await whatsappService.initialize(io);

    logger.info('Gita Support Tool is fully operational');
  } catch (err) {
    logger.error(`Failed to start: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  const { closeDb } = require('./config/database');
  closeDb();
  server.close();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});

start();
