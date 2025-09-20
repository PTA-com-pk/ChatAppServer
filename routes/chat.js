const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Message = require('../models/Message');
const User = require('../models/User');

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 1000 * 1024 * 1024, // Configurable file size limit
    files: parseInt(process.env.MAX_FILES_PER_REQUEST) || 1 // Configurable files per request
  }
  // Removed fileFilter to accept all file types
});

// Upload file
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ 
          error: 'File too large', 
          message: 'File size must be less than 100MB' 
        });
      }
      return res.status(400).json({ 
        error: 'Upload error', 
        message: err.message 
      });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

    // Determine file type
    let fileType = 'file';
    if (req.file.mimetype.startsWith('image/')) {
      fileType = 'image';
    } else if (req.file.mimetype.startsWith('video/')) {
      fileType = 'video';
    } else if (req.file.mimetype.startsWith('audio/')) {
      fileType = 'audio';
    } else if (req.file.mimetype.includes('pdf')) {
      fileType = 'pdf';
    } else if (req.file.mimetype.includes('text/') || req.file.originalname.endsWith('.txt')) {
      fileType = 'text';
    } else if (req.file.mimetype.includes('zip') || req.file.mimetype.includes('rar') || req.file.mimetype.includes('7z')) {
      fileType = 'archive';
    } else if (req.file.mimetype.includes('document') || req.file.mimetype.includes('word') || req.file.originalname.match(/\.(doc|docx)$/i)) {
      fileType = 'document';
    } else if (req.file.mimetype.includes('spreadsheet') || req.file.mimetype.includes('excel') || req.file.originalname.match(/\.(xls|xlsx)$/i)) {
      fileType = 'spreadsheet';
    } else if (req.file.mimetype.includes('presentation') || req.file.mimetype.includes('powerpoint') || req.file.originalname.match(/\.(ppt|pptx)$/i)) {
      fileType = 'presentation';
    }

      res.json({
        message: 'File uploaded successfully',
        fileType: fileType,
        file: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          size: req.file.size,
          path: `/uploads/${req.file.filename}`,
          mimetype: req.file.mimetype
        }
      });
    } catch (error) {
      console.error('File upload error:', error);
      res.status(500).json({ error: 'File upload failed' });
    }
  });
});

// Get chat history
router.get('/history', async (req, res) => {
  try {
    const { room = 'general', limit = parseInt(process.env.MESSAGE_HISTORY_LIMIT) || 50, skip = 0 } = req.query;
    
    const messages = await Message.getRoomMessages(room, parseInt(limit), parseInt(skip));
    
    // Format messages for response
    const formattedMessages = messages.map(msg => ({
      id: msg._id,
      sender: {
        id: msg.sender._id,
        username: msg.sender.username,
        avatar: msg.sender.avatar,
        isOnline: msg.sender.isOnline
      },
      content: msg.content,
      type: msg.type,
      file: msg.file,
      room: msg.room,
      isEdited: msg.isEdited,
      editedAt: msg.editedAt,
      reactions: msg.reactions,
      replyTo: msg.replyTo,
      createdAt: msg.createdAt
    }));

    res.json({ 
      messages: formattedMessages.reverse(), // Reverse to show oldest first
      hasMore: messages.length === parseInt(limit)
    });
  } catch (error) {
    console.error('Get chat history error:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Get recent messages
router.get('/recent', async (req, res) => {
  try {
    const { limit = parseInt(process.env.MESSAGE_RECENT_LIMIT) || 20 } = req.query;
    
    const messages = await Message.getRecentMessages(parseInt(limit));
    
    res.json({ messages });
  } catch (error) {
    console.error('Get recent messages error:', error);
    res.status(500).json({ error: 'Failed to fetch recent messages' });
  }
});

// Create a new message
router.post('/message', async (req, res) => {
  try {
    const { content, type = 'text', file, room = 'general', replyTo } = req.body;
    const userId = req.user.userId;

    if (!content && !file) {
      return res.status(400).json({ error: 'Message content or file is required' });
    }

    const message = new Message({
      sender: userId,
      content,
      type,
      file,
      room,
      replyTo
    });

    await message.save();
    await message.populate('sender', 'username avatar isOnline');
    
    if (replyTo) {
      await message.populate('replyTo');
    }

    res.status(201).json({
      message: 'Message created successfully',
      data: await message.getWithSender()
    });
  } catch (error) {
    console.error('Create message error:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// Edit a message
router.put('/message/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.user.userId;

    if (!content) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (!message.sender.equals(userId)) {
      return res.status(403).json({ error: 'You can only edit your own messages' });
    }

    await message.editMessage(content);
    await message.populate('sender', 'username avatar isOnline');

    res.json({
      message: 'Message updated successfully',
      data: await message.getWithSender()
    });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Delete a message
router.delete('/message/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (!message.sender.equals(userId)) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }

    await message.softDelete();

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Add reaction to message
router.post('/message/:messageId/reaction', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user.userId;

    if (!emoji) {
      return res.status(400).json({ error: 'Emoji is required' });
    }

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    await message.addReaction(userId, emoji);
    await message.populate('sender', 'username avatar isOnline');

    res.json({
      message: 'Reaction added successfully',
      data: await message.getWithSender()
    });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

// Remove reaction from message
router.delete('/message/:messageId/reaction', async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    await message.removeReaction(userId);
    await message.populate('sender', 'username avatar isOnline');

    res.json({
      message: 'Reaction removed successfully',
      data: await message.getWithSender()
    });
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
});

module.exports = router;
