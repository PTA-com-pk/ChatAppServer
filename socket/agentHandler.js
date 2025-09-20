/**
 * Agent Socket Handler
 * 
 * Handles real-time communication with compliance monitoring agents
 * via Socket.IO for command distribution and response collection.
 */

const crypto = require('crypto');

// In-memory storage for agent connections (use database in production)
const agentConnections = new Map();
const pendingCommands = new Map();

// Security configuration
const SHARED_SECRET = process.env.COMPLIANCE_SHARED_SECRET || 'CHANGE_THIS_SECRET_IN_PRODUCTION';

/**
 * Create HMAC signature for authentication
 */
function createSignature(data) {
  const hmac = crypto.createHmac('sha256', SHARED_SECRET);
  hmac.update(JSON.stringify(data));
  return hmac.digest('hex');
}

/**
 * Verify HMAC signature
 */
function verifySignature(data, signature) {
  const expectedSignature = createSignature(data);
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Handle agent socket connection
 */
function handleAgentConnection(socket, io) {
  console.log(`Agent connected: ${socket.id}`);

  // Agent authentication
  socket.on('agent:authenticate', async (authData) => {
    try {
      const { agentId, platform, timestamp, signature } = authData;

      // Validate required fields
      if (!agentId || !platform || !timestamp || !signature) {
        socket.emit('agent:auth_failed', {
          message: 'Missing required authentication fields'
        });
        return;
      }

      // Verify signature
      const authPayload = { agentId, platform, timestamp };
      if (!verifySignature(authPayload, signature)) {
        socket.emit('agent:auth_failed', {
          message: 'Invalid authentication signature'
        });
        return;
      }

      // Check timestamp (prevent replay attacks)
      const now = Date.now();
      const timeDiff = Math.abs(now - timestamp);
      if (timeDiff > 300000) { // 5 minute window
        socket.emit('agent:auth_failed', {
          message: 'Authentication timestamp expired'
        });
        return;
      }

      // Register agent connection
      agentConnections.set(agentId, {
        socketId: socket.id,
        agentId,
        platform,
        connectedAt: now,
        lastSeen: now,
        status: 'authenticated'
      });

      // Store agent ID in socket for easy access
      socket.agentId = agentId;

      // Generate response signature
      const response = {
        status: 'authenticated',
        agentId,
        timestamp: now
      };

      response.signature = createSignature(response);

      socket.emit('agent:authenticated', response);

      console.log(`Agent authenticated: ${agentId} (${platform})`);

    } catch (error) {
      console.error('Agent authentication error:', error);
      socket.emit('agent:auth_failed', {
        message: 'Authentication failed'
      });
    }
  });

  // Handle command responses
  socket.on('response:command', (response) => {
    try {
      const { commandId, agentId, module, status, data, error, executionTime } = response;

      // Validate required fields
      if (!commandId || !agentId || !status) {
        console.error('Invalid command response:', response);
        return;
      }

      // Update pending command
      if (pendingCommands.has(commandId)) {
        const command = pendingCommands.get(commandId);
        command.status = status;
        command.completedAt = Date.now();
        command.response = response;

        // Remove from pending after a delay
        setTimeout(() => {
          pendingCommands.delete(commandId);
        }, 300000); // 5 minutes
      }

      // Update agent status
      if (agentConnections.has(agentId)) {
        const agent = agentConnections.get(agentId);
        agent.lastSeen = Date.now();
        agent.status = 'active';
      }

      console.log(`Command response received: ${commandId} from ${agentId} - ${status}`);

    } catch (error) {
      console.error('Command response handling error:', error);
    }
  });

  // Handle ping responses
  socket.on('response:ping', (response) => {
    try {
      const { agentId, timestamp, status } = response;

      if (agentConnections.has(agentId)) {
        const agent = agentConnections.get(agentId);
        agent.lastSeen = Date.now();
        agent.status = status || 'alive';
      }

    } catch (error) {
      console.error('Ping response handling error:', error);
    }
  });

  // Handle system data
  socket.on('data:system', (data) => {
    try {
      const { agentId, data: systemData, timestamp } = data;

      if (agentConnections.has(agentId)) {
        const agent = agentConnections.get(agentId);
        agent.lastSeen = Date.now();
        agent.lastSystemData = systemData;
      }

      // Broadcast system data to admin clients (if any)
      io.to('admin').emit('agent:system_data', {
        agentId,
        data: systemData,
        timestamp
      });

    } catch (error) {
      console.error('System data handling error:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    if (socket.agentId) {
      console.log(`Agent disconnected: ${socket.agentId} - ${reason}`);
      
      if (agentConnections.has(socket.agentId)) {
        const agent = agentConnections.get(socket.agentId);
        agent.status = 'disconnected';
        agent.disconnectedAt = Date.now();
      }
    }
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error(`Agent socket error (${socket.agentId || socket.id}):`, error);
  });
}

/**
 * Send command to specific agent
 */
function sendCommandToAgent(io, agentId, command) {
  const agent = agentConnections.get(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Create command with authentication
  const authenticatedCommand = {
    ...command,
    timestamp: Date.now()
  };

  // Add authentication hash
  authenticatedCommand.authHash = crypto
    .createHash('sha256')
    .update(authenticatedCommand.id + authenticatedCommand.action + SHARED_SECRET)
    .digest('hex');

  // Store as pending command
  pendingCommands.set(command.id, {
    ...authenticatedCommand,
    status: 'sent',
    sentAt: Date.now()
  });

  // Send command to agent
  const socket = io.sockets.sockets.get(agent.socketId);
  if (socket) {
    socket.emit(`command:${command.module}`, authenticatedCommand);
    return true;
  } else {
    throw new Error(`Agent socket not found: ${agentId}`);
  }
}

/**
 * Broadcast command to all agents
 */
function broadcastCommandToAllAgents(io, command) {
  const activeAgents = Array.from(agentConnections.values())
    .filter(agent => agent.status === 'authenticated' || agent.status === 'active');

  const results = [];
  
  for (const agent of activeAgents) {
    try {
      const result = sendCommandToAgent(io, agent.agentId, command);
      results.push({ agentId: agent.agentId, success: true });
    } catch (error) {
      results.push({ agentId: agent.agentId, success: false, error: error.message });
    }
  }

  return results;
}

/**
 * Get agent connection status
 */
function getAgentStatus(agentId) {
  return agentConnections.get(agentId) || null;
}

/**
 * Get all agent connections
 */
function getAllAgentConnections() {
  return Array.from(agentConnections.values());
}

/**
 * Cleanup inactive agents
 */
function cleanupInactiveAgents() {
  const now = Date.now();
  const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

  let cleanedCount = 0;

  for (const [agentId, agent] of agentConnections) {
    if (now - agent.lastSeen > inactiveThreshold) {
      agentConnections.delete(agentId);
      cleanedCount++;
    }
  }

  return cleanedCount;
}

/**
 * Setup admin room for real-time monitoring
 */
function setupAdminRoom(socket) {
  socket.join('admin');
  console.log('Admin joined monitoring room');
}

module.exports = {
  handleAgentConnection,
  sendCommandToAgent,
  broadcastCommandToAllAgents,
  getAgentStatus,
  getAllAgentConnections,
  cleanupInactiveAgents,
  setupAdminRoom
};
