const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const { handleAgentConnection } = require('./agentHandler');

// In-memory storage for active socket connections
const activeUsers = new Map();

const handleSocketConnection = (socket, io) => {
  console.log('New client connected:', socket.id);

  // Check if this is an agent connection
  socket.on('agent:authenticate', (authData) => {
    handleAgentConnection(socket, io);
    socket.emit('agent:authenticate', authData);
  });

  // Handle authentication
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Find user in database
      const user = await User.findById(decoded.userId);
      if (!user) {
        socket.emit('authError', { error: 'User not found' });
        socket.disconnect();
        return;
      }

      socket.userId = decoded.userId;
      socket.username = decoded.username;
      
      // Update user online status
      await user.setOnlineStatus(true, socket.id);
      
      // Add user to active users
      activeUsers.set(socket.id, {
        userId: decoded.userId,
        username: decoded.username,
        socketId: socket.id
      });

      // Join user to a general room
      socket.join('general');
      
      // Notify others about new user
      socket.to('general').emit('userJoined', {
        userId: decoded.userId,
        username: decoded.username,
        avatar: user.avatar,
        isOnline: true
      });

      // Send current active users to the new user
      const onlineUsers = await User.find({ isOnline: true }, 'username avatar isOnline lastSeen');
      socket.emit('activeUsers', onlineUsers.map(u => ({
        userId: u._id,
        username: u.username,
        avatar: u.avatar,
        isOnline: u.isOnline,
        lastSeen: u.lastSeen
      })));

      // Send recent messages from database
      const recentMessages = await Message.getRecentMessages(parseInt(process.env.MESSAGE_HISTORY_LIMIT) || 50);
      socket.emit('messageHistory', recentMessages);

      console.log(`User ${decoded.username} authenticated and joined`);
    } catch (error) {
      console.error('Authentication error:', error);
      socket.emit('authError', { error: 'Invalid token' });
      socket.disconnect();
    }
  });

  // Handle new messages
  socket.on('sendMessage', async (data) => {
    if (!socket.userId) {
      socket.emit('error', { error: 'Not authenticated' });
      return;
    }

    try {
      // Create message in database
      const message = new Message({
        sender: socket.userId,
        content: data.content,
        type: data.type || 'text',
        file: data.file || null,
        room: data.room || 'general',
        replyTo: data.replyTo || null
      });

      await message.save();
      await message.populate('sender', 'username avatar isOnline');
      
      if (data.replyTo) {
        await message.populate('replyTo');
      }

      // Format message for socket emission
      const formattedMessage = {
        id: message._id,
        sender: {
          id: message.sender._id,
          username: message.sender.username,
          avatar: message.sender.avatar,
          isOnline: message.sender.isOnline
        },
        content: message.content,
        type: message.type,
        file: message.file,
        room: message.room,
        isEdited: message.isEdited,
        editedAt: message.editedAt,
        reactions: message.reactions,
        replyTo: message.replyTo,
        createdAt: message.createdAt
      };

      // Broadcast message to all users in the room
      io.to(data.room || 'general').emit('newMessage', formattedMessage);
      
      console.log(`Message sent by ${socket.username}: ${data.content.substring(0, 50)}...`);
    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', { error: 'Failed to send message' });
    }
  });

  // Handle typing indicators
  socket.on('typing', (data) => {
    if (!socket.userId) return;
    
    socket.to('general').emit('userTyping', {
      userId: socket.userId,
      username: socket.username,
      isTyping: data.isTyping
    });
  });

  // Handle video/audio call requests
  socket.on('callRequest', (data) => {
    const targetUser = Array.from(activeUsers.values())
      .find(user => user.userId === data.targetUserId);
    
    if (targetUser) {
      io.to(targetUser.socketId).emit('incomingCall', {
        from: socket.userId,
        fromUsername: socket.username,
        callType: data.callType // 'video' or 'audio'
      });
    }
  });

  // Handle call response
  socket.on('callResponse', (data) => {
    const caller = Array.from(activeUsers.values())
      .find(user => user.userId === data.callerId);
    
    if (caller) {
      io.to(caller.socketId).emit('callResponse', {
        accepted: data.accepted,
        from: socket.userId,
        fromUsername: socket.username
      });
    }
  });

  // Handle WebRTC signaling
  socket.on('webrtc-signal', (data) => {
    const targetUser = Array.from(activeUsers.values())
      .find(user => user.userId === data.targetUserId);
    
    if (targetUser) {
      io.to(targetUser.socketId).emit('webrtc-signal', {
        signal: data.signal,
        from: socket.userId
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    if (socket.userId && activeUsers.has(socket.id)) {
      const user = activeUsers.get(socket.id);
      activeUsers.delete(socket.id);
      
      try {
        // Update user offline status in database
        const dbUser = await User.findById(socket.userId);
        if (dbUser) {
          await dbUser.setOnlineStatus(false);
        }
        
        // Notify others about user leaving
        socket.to('general').emit('userLeft', {
          userId: user.userId,
          username: user.username
        });
        
        console.log(`User ${user.username} disconnected`);
      } catch (error) {
        console.error('Disconnect error:', error);
      }
    }
  });
};

module.exports = { handleSocketConnection };
