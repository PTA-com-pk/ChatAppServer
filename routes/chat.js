const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
    fileSize: 1000 * 1024 * 1024, // 1000MB limit
    files: 1 // Only allow one file at a time
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

// Get chat history (placeholder - in production, implement with database)
router.get('/history', (req, res) => {
  // This would typically fetch from a database
  res.json({ messages: [] });
});

module.exports = router;
