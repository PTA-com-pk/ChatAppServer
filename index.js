const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const winston = require('winston');
require('dotenv').config();

// Database connection
const { connectDB, checkDatabaseHealth } = require('./config/database');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const agentRoutes = require('./routes/agents');
const { authenticateToken } = require('./middleware/auth');
const { handleSocketConnection } = require('./socket/socketHandler');
const performanceMonitor = require('./utils/performance');

const app = express();
const server = http.createServer(app);

// CORS origins configuration
const corsOrigins = process.env.NODE_ENV === 'production' 
  ? (process.env.CORS_ORIGIN_PRODUCTION || "https://chatappserver-psyf.onrender.com").split(',')
  : (process.env.CORS_ORIGIN_DEVELOPMENT || "http://localhost:3000,http://localhost:19006").split(',');

const io = socketIo(server, {
  cors: {
    origin: corsOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: parseInt(process.env.SOCKET_PING_TIMEOUT) || 60000,
  pingInterval: parseInt(process.env.SOCKET_PING_INTERVAL) || 25000,
  maxHttpBufferSize: parseInt(process.env.SOCKET_MAX_HTTP_BUFFER_SIZE) || 1e6,
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

const PORT = process.env.PORT || 5000;

// Configure Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'chat-app-server' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Increase server timeout for slow responses
server.timeout = 120000; // 2 minutes
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

// Security middleware
if (process.env.HELMET_ENABLED !== 'false') {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    crossOriginEmbedderPolicy: false
  }));
}

// Compression middleware
if (process.env.COMPRESSION_ENABLED !== 'false') {
  app.use(compression());
}

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// CORS middleware
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  
  logger.info('Request started', {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = duration > 30000 ? 'warn' : 'info';
    
    // Record performance metrics
    performanceMonitor.recordRequest(duration);
    if (res.statusCode >= 400) {
      performanceMonitor.recordError();
    }
    
    logger[logLevel]('Request completed', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });
  
  next();
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy for production deployments
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Only serve static files if the build directory exists
const buildPath = path.join(__dirname, '../client/build');
if (require('fs').existsSync(buildPath)) {
  app.use(express.static(buildPath, {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0'
  }));
}

// File uploads with security
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
  setHeaders: (res, path) => {
    // Security headers for uploaded files
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
  }
}));

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    const performanceHealth = performanceMonitor.getHealthStatus();
    const healthData = {
      status: performanceHealth.status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealth,
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      memory: process.memoryUsage(),
      pid: process.pid,
      performance: performanceHealth
    };
    
    logger.info('Health check requested', { ip: req.ip, status: performanceHealth.status });
    res.json(healthData);
  } catch (error) {
    logger.error('Health check failed', { error: error.message, stack: error.stack });
    res.status(500).json({
      status: 'error',
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Performance metrics endpoint
app.get('/api/metrics', authenticateToken, (req, res) => {
  try {
    const metrics = performanceMonitor.getMetrics();
    res.json(metrics);
  } catch (error) {
    logger.error('Metrics request failed', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve metrics'
    });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', authenticateToken, chatRoutes);
app.use('/api/agents', agentRoutes);

// Socket.IO connection handling
io.on('connection', (socket) => handleSocketConnection(socket, io));

// Serve React app only if build exists, otherwise return API info
app.get('*', (req, res) => {
  const buildPath = path.join(__dirname, '../client/build', 'index.html');
  if (require('fs').existsSync(buildPath)) {
    res.sendFile(buildPath);
  } else {
    res.json({
      message: 'RTN Circle API Server',
      version: '1.0.0',
      endpoints: {
        health: '/api/health',
        auth: '/api/auth',
        chat: '/api/chat',
        agents: '/api/agents'
      },
      status: 'running'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip
  });
  
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn('404 Not Found', { path: req.path, method: req.method, ip: req.ip });
  res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const startServer = async () => {
  try {
    // Ensure logs directory exists
    const fs = require('fs');
    if (!fs.existsSync('./logs')) {
      fs.mkdirSync('./logs');
    }
    
    // Connect to MongoDB
    await connectDB();
    
    // Start HTTP server
    server.listen(PORT, () => {
      logger.info('Server started successfully', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        pid: process.pid
      });
      
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
