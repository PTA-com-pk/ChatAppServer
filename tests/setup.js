// Test setup file
const mongoose = require('mongoose');

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.MONGODB_URI = 'mongodb://localhost:27017/rtn-circle-test';

// Global test setup
beforeAll(async () => {
  // Connect to test database
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }
});

afterAll(async () => {
  // Clean up test database
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.db.dropDatabase();
    await mongoose.connection.close();
  }
});

// Global test utilities
global.testUtils = {
  generateTestUser: () => ({
    username: 'testuser',
    email: 'test@example.com',
    password: 'testpassword123'
  }),
  
  generateTestMessage: (userId) => ({
    content: 'Test message',
    sender: userId,
    timestamp: new Date()
  })
};
