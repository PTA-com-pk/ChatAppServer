const jwt = require('jsonwebtoken');

// In-memory storage for active users and messages
const activeUsers = new Map();
const messages = [];

const handleSocketConnection = (socket, io) => {
  console.log('New client connected:', socket.id);

  // Handle authentication
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.username = decoded.username;
      
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
        username: decoded.username
      });

      // Send current active users to the new user
      socket.emit('activeUsers', Array.from(activeUsers.values()));

      // Send recent messages
      socket.emit('messageHistory', messages.slice(-50)); // Last 50 messages

      console.log(`User ${decoded.username} authenticated and joined`);
    } catch (error) {
      socket.emit('authError', { error: 'Invalid token' });
      socket.disconnect();
    }
  });

  // Handle new messages
  socket.on('sendMessage', (data) => {
    if (!socket.userId) {
      socket.emit('error', { error: 'Not authenticated' });
      return;
    }

    const message = {
      id: Date.now() + Math.random(),
      userId: socket.userId,
      username: socket.username,
      content: data.content,
      type: data.type || 'text',
      file: data.file || null,
      timestamp: new Date().toISOString()
    };

    messages.push(message);

    // Broadcast message to all users in the room
    io.to('general').emit('newMessage', message);
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
  socket.on('disconnect', () => {
    if (socket.userId && activeUsers.has(socket.id)) {
      const user = activeUsers.get(socket.id);
      activeUsers.delete(socket.id);
      
      // Notify others about user leaving
      socket.to('general').emit('userLeft', {
        userId: user.userId,
        username: user.username
      });
      
      console.log(`User ${user.username} disconnected`);
    }
  });
};

module.exports = { handleSocketConnection };
