const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const r2Service = require('../services/r2Service');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../temp');
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate a unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'upload-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max file size
  },
  fileFilter: function (req, file, cb) {
    // Accept only video files
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

// Handle file uploads
router.post('/', upload.single('file'), async (req, res) => {
  try {
    console.log('[UPLOAD ROUTE] File upload request received');
    
    if (!req.file) {
      console.error('[UPLOAD ROUTE] No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    console.log('[UPLOAD ROUTE] File details:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    });
    
    // Upload the file to R2
    const result = await r2Service.uploadFileFromPath(
      req.file.path,
      req.file.originalname,
      req.file.mimetype
    );
    
    console.log('[UPLOAD ROUTE] R2 upload result:', result);
    
    // Clean up the temporary file
    try {
      fs.unlinkSync(req.file.path);
      console.log('[UPLOAD ROUTE] Temporary file deleted');
    } catch (cleanupError) {
      console.error('[UPLOAD ROUTE] Error cleaning up temporary file:', cleanupError?.message);
    }
    
    // Return the R2 URL
    res.status(200).json({
      success: true,
      url: result.url,
      key: result.key
    });
  } catch (error) {
    console.error('[UPLOAD ROUTE] Error handling upload:', error?.message);
    res.status(500).json({ error: 'Error uploading file', details: error?.message });
  }
});

// Handle URL uploads (download from URL and upload to R2)
router.post('/from-url', express.json(), async (req, res) => {
  try {
    console.log('[UPLOAD ROUTE] URL upload request received');
    
    const { url, fileName } = req?.body || {};
    
    if (!url) {
      console.error('[UPLOAD ROUTE] No URL provided');
      return res.status(400).json({ error: 'URL is required' });
    }
    
    console.log('[UPLOAD ROUTE] URL upload details:', {
      url,
      fileName: fileName || '(auto-generated)'
    });
    
    // Download from URL and upload to R2
    const result = await r2Service.uploadFileFromUrl(url, fileName);
    
    console.log('[UPLOAD ROUTE] R2 upload result:', result);
    
    // Return the R2 URL
    res.status(200).json({
      success: true,
      url: result.url,
      key: result.key
    });
  } catch (error) {
    console.error('[UPLOAD ROUTE] Error handling URL upload:', error?.message);
    res.status(500).json({ error: 'Error uploading from URL', details: error?.message });
  }
});

module.exports = router; 