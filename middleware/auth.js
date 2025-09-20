const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      code: 'MISSING_TOKEN'
    });
  }

  // Validate token format
  if (!/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/.test(token)) {
    return res.status(401).json({ 
      error: 'Invalid token format',
      code: 'INVALID_TOKEN_FORMAT'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      let errorMessage = 'Invalid or expired token';
      let errorCode = 'INVALID_TOKEN';
      
      if (err.name === 'TokenExpiredError') {
        errorMessage = 'Token has expired';
        errorCode = 'TOKEN_EXPIRED';
      } else if (err.name === 'JsonWebTokenError') {
        errorMessage = 'Invalid token';
        errorCode = 'INVALID_TOKEN';
      }
      
      return res.status(403).json({ 
        error: errorMessage,
        code: errorCode
      });
    }
    
    // Additional security checks
    if (!user || !user.userId) {
      return res.status(403).json({ 
        error: 'Invalid token payload',
        code: 'INVALID_TOKEN_PAYLOAD'
      });
    }
    
    // Check if token is not too old (additional security)
    const tokenAge = Date.now() - (user.iat * 1000);
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    if (tokenAge > maxAge) {
      return res.status(403).json({ 
        error: 'Token is too old, please re-authenticate',
        code: 'TOKEN_TOO_OLD'
      });
    }
    
    req.user = user;
    next();
  });
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      req.user = null;
    } else {
      req.user = user;
    }
    next();
  });
};

module.exports = { 
  authenticateToken, 
  optionalAuth, 
  authLimiter 
};
