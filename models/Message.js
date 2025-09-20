const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: parseInt(process.env.MESSAGE_MAX_LENGTH) || 2000
  },
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'file', 'document'],
    default: 'text'
  },
  file: {
    filename: String,
    originalName: String,
    size: Number,
    path: String,
    mimetype: String
  },
  room: {
    type: String,
    default: 'general'
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date,
    default: null
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  reactions: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    emoji: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  }
}, {
  timestamps: true
});

// Indexes for better query performance
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ room: 1, createdAt: -1 });
messageSchema.index({ createdAt: -1 });
messageSchema.index({ isDeleted: 1 });

// Virtual for formatted timestamp
messageSchema.virtual('formattedTime').get(function() {
  return this.createdAt.toISOString();
});

// Method to get message with sender info
messageSchema.methods.getWithSender = async function() {
  await this.populate('sender', 'username avatar isOnline');
  return {
    id: this._id,
    sender: {
      id: this.sender._id,
      username: this.sender.username,
      avatar: this.sender.avatar,
      isOnline: this.sender.isOnline
    },
    content: this.content,
    type: this.type,
    file: this.file,
    room: this.room,
    isEdited: this.isEdited,
    editedAt: this.editedAt,
    isDeleted: this.isDeleted,
    reactions: this.reactions,
    replyTo: this.replyTo,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

// Static method to get messages for a room
messageSchema.statics.getRoomMessages = async function(room = 'general', limit = parseInt(process.env.MESSAGE_HISTORY_LIMIT) || 50, skip = 0) {
  return this.find({ 
    room, 
    isDeleted: false 
  })
  .populate('sender', 'username avatar isOnline')
  .populate('replyTo')
  .sort({ createdAt: -1 })
  .limit(limit)
  .skip(skip)
  .lean();
};

// Static method to get recent messages
messageSchema.statics.getRecentMessages = async function(limit = parseInt(process.env.MESSAGE_RECENT_LIMIT) || 20) {
  return this.find({ isDeleted: false })
    .populate('sender', 'username avatar isOnline')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

// Method to soft delete message
messageSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Method to edit message
messageSchema.methods.editMessage = function(newContent) {
  this.content = newContent;
  this.isEdited = true;
  this.editedAt = new Date();
  return this.save();
};

// Method to add reaction
messageSchema.methods.addReaction = function(userId, emoji) {
  // Remove existing reaction from this user
  this.reactions = this.reactions.filter(reaction => 
    !reaction.user.equals(userId)
  );
  
  // Add new reaction
  this.reactions.push({
    user: userId,
    emoji: emoji
  });
  
  return this.save();
};

// Method to remove reaction
messageSchema.methods.removeReaction = function(userId) {
  this.reactions = this.reactions.filter(reaction => 
    !reaction.user.equals(userId)
  );
  return this.save();
};

module.exports = mongoose.model('Message', messageSchema);
