/**
 * Agent Management Routes
 * 
 * Handles agent authentication, command distribution,
 * and response collection for compliance monitoring.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// In-memory storage for active agents (use database in production)
const activeAgents = new Map();
const agentCommands = new Map();
const agentResponses = new Map();

// Security configuration
const SHARED_SECRET = process.env.COMPLIANCE_SHARED_SECRET || 'CHANGE_THIS_SECRET_IN_PRODUCTION';
const ENCRYPTION_KEY = process.env.COMPLIANCE_ENCRYPTION_KEY || 'CHANGE_THIS_ENCRYPTION_KEY_32_CHARS';

/**
 * Create HMAC signature for authentication
 */
function createSignature(data) {
  const hmac = crypto.createHmac('sha256', SHARED_SECRET);
  hmac.update(JSON.stringify(data));
  return hmac.digest('hex');
}

/**
 * Verify HMAC signature (supports both HMAC and simple base64 for mobile)
 */
function verifySignature(data, signature) {
  // Try HMAC verification first
  const expectedSignature = createSignature(data);
  if (crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  )) {
    return true;
  }
  
  // Fallback to simple base64 verification for mobile compatibility
  const simpleSignature = Buffer.from(JSON.stringify(data) + SHARED_SECRET).toString('base64').substring(0, 32);
  return signature === simpleSignature;
}

/**
 * Authenticate agent connection
 */
router.post('/authenticate', (req, res) => {
  try {
    const { agentId, platform, timestamp, signature } = req.body;

    // Validate required fields
    if (!agentId || !platform || !timestamp || !signature) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required authentication fields'
      });
    }

    // Verify signature
    const authData = { agentId, platform, timestamp };
    if (!verifySignature(authData, signature)) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid authentication signature'
      });
    }

    // Check timestamp (prevent replay attacks)
    const now = Date.now();
    const timeDiff = Math.abs(now - timestamp);
    if (timeDiff > 300000) { // 5 minute window
      return res.status(401).json({
        status: 'error',
        message: 'Authentication timestamp expired'
      });
    }

    // Register agent
    activeAgents.set(agentId, {
      agentId,
      platform,
      connectedAt: now,
      lastSeen: now,
      status: 'authenticated'
    });

    // Generate response signature
    const response = {
      status: 'authenticated',
      agentId,
      timestamp: now
    };

    response.signature = createSignature(response);

    res.json(response);

  } catch (error) {
    console.error('Agent authentication error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Authentication failed'
    });
  }
});

/**
 * Send command to agent
 */
router.post('/command', (req, res) => {
  try {
    const { agentId, module, action, params, priority = 'normal' } = req.body;

    // Validate required fields
    if (!agentId || !module || !action) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required command fields'
      });
    }

    // Check if agent is active
    if (!activeAgents.has(agentId)) {
      return res.status(404).json({
        status: 'error',
        message: 'Agent not found or not authenticated'
      });
    }

    // Create command
    const command = {
      id: crypto.randomUUID(),
      agentId,
      module,
      action,
      params: params || {},
      priority,
      timestamp: Date.now(),
      status: 'pending'
    };

    // Add authentication hash
    command.authHash = crypto
      .createHash('sha256')
      .update(command.id + command.action + SHARED_SECRET)
      .digest('hex');

    // Store command
    agentCommands.set(command.id, command);

    // Update agent status
    const agent = activeAgents.get(agentId);
    agent.lastSeen = Date.now();
    agent.status = 'command_sent';

    res.json({
      status: 'success',
      commandId: command.id,
      message: 'Command sent to agent'
    });

  } catch (error) {
    console.error('Command sending error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to send command'
    });
  }
});

/**
 * Receive command response from agent
 */
router.post('/response', (req, res) => {
  try {
    const { commandId, agentId, module, status, data, error, executionTime } = req.body;

    // Validate required fields
    if (!commandId || !agentId || !status) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required response fields'
      });
    }

    // Check if command exists
    if (!agentCommands.has(commandId)) {
      return res.status(404).json({
        status: 'error',
        message: 'Command not found'
      });
    }

    // Create response record
    const response = {
      commandId,
      agentId,
      module,
      status,
      data,
      error,
      executionTime,
      receivedAt: Date.now()
    };

    // Store response
    agentResponses.set(commandId, response);

    // Update command status
    const command = agentCommands.get(commandId);
    command.status = status;
    command.completedAt = Date.now();

    // Update agent status
    const agent = activeAgents.get(agentId);
    if (agent) {
      agent.lastSeen = Date.now();
      agent.status = 'active';
    }

    res.json({
      status: 'success',
      message: 'Response received'
    });

  } catch (error) {
    console.error('Response handling error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to process response'
    });
  }
});

/**
 * Get agent status
 */
router.get('/status/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;

    if (!activeAgents.has(agentId)) {
      return res.status(404).json({
        status: 'error',
        message: 'Agent not found'
      });
    }

    const agent = activeAgents.get(agentId);
    const pendingCommands = Array.from(agentCommands.values())
      .filter(cmd => cmd.agentId === agentId && cmd.status === 'pending');

    res.json({
      status: 'success',
      agent: {
        ...agent,
        pendingCommands: pendingCommands.length
      }
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get agent status'
    });
  }
});

/**
 * List all active agents
 */
router.get('/agents', (req, res) => {
  try {
    const agents = Array.from(activeAgents.values()).map(agent => ({
      ...agent,
      pendingCommands: Array.from(agentCommands.values())
        .filter(cmd => cmd.agentId === agent.agentId && cmd.status === 'pending').length
    }));

    res.json({
      status: 'success',
      agents,
      total: agents.length
    });

  } catch (error) {
    console.error('Agent listing error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to list agents'
    });
  }
});

/**
 * Get command history
 */
router.get('/commands', (req, res) => {
  try {
    const { agentId, limit = 100, status } = req.query;

    let commands = Array.from(agentCommands.values());

    // Filter by agent if specified
    if (agentId) {
      commands = commands.filter(cmd => cmd.agentId === agentId);
    }

    // Filter by status if specified
    if (status) {
      commands = commands.filter(cmd => cmd.status === status);
    }

    // Sort by timestamp (newest first)
    commands.sort((a, b) => b.timestamp - a.timestamp);

    // Limit results
    commands = commands.slice(0, parseInt(limit));

    res.json({
      status: 'success',
      commands,
      total: commands.length
    });

  } catch (error) {
    console.error('Command history error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get command history'
    });
  }
});

/**
 * Get response history
 */
router.get('/responses', (req, res) => {
  try {
    const { commandId, agentId, limit = 100 } = req.query;

    let responses = Array.from(agentResponses.values());

    // Filter by command ID if specified
    if (commandId) {
      responses = responses.filter(resp => resp.commandId === commandId);
    }

    // Filter by agent if specified
    if (agentId) {
      responses = responses.filter(resp => resp.agentId === agentId);
    }

    // Sort by timestamp (newest first)
    responses.sort((a, b) => b.receivedAt - a.receivedAt);

    // Limit results
    responses = responses.slice(0, parseInt(limit));

    res.json({
      status: 'success',
      responses,
      total: responses.length
    });

  } catch (error) {
    console.error('Response history error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get response history'
    });
  }
});

/**
 * Cleanup inactive agents
 */
router.post('/cleanup', (req, res) => {
  try {
    const now = Date.now();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

    let cleanedCount = 0;

    for (const [agentId, agent] of activeAgents) {
      if (now - agent.lastSeen > inactiveThreshold) {
        activeAgents.delete(agentId);
        cleanedCount++;
      }
    }

    res.json({
      status: 'success',
      message: `Cleaned up ${cleanedCount} inactive agents`
    });

  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to cleanup agents'
    });
  }
});

/**
 * Broadcast command to all agents
 */
router.post('/broadcast', (req, res) => {
  try {
    const { module, action, params, priority = 'normal' } = req.body;

    // Validate required fields
    if (!module || !action) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required broadcast fields'
      });
    }

    const activeAgentIds = Array.from(activeAgents.keys());
    const sentCommands = [];

    // Send command to all active agents
    for (const agentId of activeAgentIds) {
      const command = {
        id: crypto.randomUUID(),
        agentId,
        module,
        action,
        params: params || {},
        priority,
        timestamp: Date.now(),
        status: 'pending'
      };

      command.authHash = crypto
        .createHash('sha256')
        .update(command.id + command.action + SHARED_SECRET)
        .digest('hex');

      agentCommands.set(command.id, command);
      sentCommands.push(command.id);
    }

    res.json({
      status: 'success',
      message: `Command broadcast to ${activeAgentIds.length} agents`,
      commandIds: sentCommands
    });

  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to broadcast command'
    });
  }
});

module.exports = router;
