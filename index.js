const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Database connection
const { connectDB, checkDatabaseHealth } = require('./config/database');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const agentRoutes = require('./routes/agents');
const { authenticateToken } = require('./middleware/auth');
const { handleSocketConnection } = require('./socket/socketHandler');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ["https://chatappserver-psyf.onrender.com", "http://192.168.1.10:8081"] 
      : ["http://localhost:3000", "http://localhost:19006", "exp://192.168.1.100:19000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 5000;

// Increase server timeout for slow responses
server.timeout = 120000; // 2 minutes
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ["https://chatappserver-psyf.onrender.com", "http://192.168.1.10:8081"] 
    : ["http://localhost:3000", "http://localhost:19006", "exp://192.168.1.100:19000"],
  credentials: true
}));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    
    if (duration > 30000) {
      console.warn(`⚠️  Slow request detected: ${req.method} ${req.path} took ${duration}ms`);
    }
  });
  
  next();
});

app.use(express.json());
// Only serve static files if the build directory exists
const buildPath = path.join(__dirname, '../client/build');
if (require('fs').existsSync(buildPath)) {
  app.use(express.static(buildPath));
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealth,
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
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

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
