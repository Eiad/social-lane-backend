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

// Configure multer with increased limits for large files
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

// Configure multer with memory storage for small files
const memoryStorage = multer.memoryStorage();
const uploadToMemory = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size for memory storage
  },
});

// Handle file uploads (new streaming method)
router.post('/', async (req, res) => {
  try {
    console.log('[UPLOAD ROUTE] File upload request received');
    
    // Create temp directory if it doesn't exist
    const uploadDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    // Generate a unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const tempFilePath = path.join(uploadDir, `upload-${uniqueSuffix}.mp4`);
    const writeStream = fs.createWriteStream(tempFilePath);
    
    // Set up error handling for the request and stream
    let error = null;
    let requestFinished = false;
    let bytesReceived = 0;
    
    // Set up error handling for the request
    req.on('error', (err) => {
      console.error('[UPLOAD ROUTE] Request error:', err);
      error = err;
      writeStream.end();
    });
    
    // Handle aborted connections
    req.on('aborted', () => {
      console.error('[UPLOAD ROUTE] Request aborted by client');
      error = new Error('Request aborted by client');
      writeStream.end();
    });
    
    // Track data received for logging
    req.on('data', (chunk) => {
      bytesReceived += chunk.length;
      
      // Log progress for large files every 50MB
      if (bytesReceived % (50 * 1024 * 1024) < chunk.length) {
        console.log(`[UPLOAD ROUTE] Received ${(bytesReceived / (1024 * 1024)).toFixed(2)} MB so far`);
      }
    });
    
    // Handle request completion
    req.on('end', () => {
      console.log(`[UPLOAD ROUTE] Request completed, received ${(bytesReceived / (1024 * 1024)).toFixed(2)} MB total`);
      requestFinished = true;
    });
    
    // Set up error handling for the write stream
    writeStream.on('error', (err) => {
      console.error('[UPLOAD ROUTE] Write stream error:', err);
      error = err;
      req.unpipe(writeStream);
      
      // Clean up the partial file if it exists
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (e) {
        console.error('[UPLOAD ROUTE] Error cleaning up partial file:', e?.message);
      }
    });
    
    // When the file upload is complete, process it
    writeStream.on('finish', async () => {
      if (error) {
        console.error('[UPLOAD ROUTE] Error during file upload:', error);
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (e) {
          console.error('[UPLOAD ROUTE] Error cleaning up temporary file:', e?.message);
        }
        
        // Only send response if headers haven't been sent yet
        if (!res.headersSent) {
          return res.status(500).json({ error: 'Error uploading file', details: error?.message });
        }
        return;
      }
      
      if (!requestFinished) {
        console.error('[UPLOAD ROUTE] Stream finished but request did not complete properly');
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (e) {
          console.error('[UPLOAD ROUTE] Error cleaning up temporary file:', e?.message);
        }
        
        if (!res.headersSent) {
          return res.status(500).json({ error: 'Upload stream ended prematurely' });
        }
        return;
      }
      
      try {
        // Make sure the file exists and has content
        const stats = fs.statSync(tempFilePath);
        console.log('[UPLOAD ROUTE] File received successfully, size:', stats.size);
        
        if (stats.size === 0) {
          console.error('[UPLOAD ROUTE] Received empty file');
          try {
            fs.unlinkSync(tempFilePath);
          } catch (e) {
            console.error('[UPLOAD ROUTE] Error cleaning up empty file:', e?.message);
          }
          
          if (!res.headersSent) {
            return res.status(400).json({ error: 'Received empty file' });
          }
          return;
        }
        
        // Upload the file to R2
        const contentType = req.headers['content-type'] || 'video/mp4';
        const originalFilename = req.headers['x-file-name'] || `video-${uniqueSuffix}.mp4`;
        
        console.log('[UPLOAD ROUTE] File details:', {
          originalname: originalFilename,
          contentType: contentType,
          size: stats.size,
          path: tempFilePath
        });
        
        // Upload the file to R2
        const result = await r2Service.uploadFileFromPath(
          tempFilePath,
          originalFilename,
          contentType
        );
        
        console.log('[UPLOAD ROUTE] R2 upload result:', result);
        
        // Clean up the temporary file
        try {
          fs.unlinkSync(tempFilePath);
          console.log('[UPLOAD ROUTE] Temporary file deleted');
        } catch (cleanupError) {
          console.error('[UPLOAD ROUTE] Error cleaning up temporary file:', cleanupError?.message);
        }
        
        // Return the R2 URL if headers haven't been sent yet
        if (!res.headersSent) {
          res.status(200).json({
            success: true,
            url: result.url,
            key: result.key
          });
        }
      } catch (uploadError) {
        console.error('[UPLOAD ROUTE] Error uploading to R2:', uploadError?.message);
        
        // Clean up the temporary file
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (e) {
          console.error('[UPLOAD ROUTE] Error cleaning up temporary file:', e?.message);
        }
        
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error uploading file to R2', details: uploadError?.message });
        }
      }
    });
    
    // Pipe the request directly to the file
    req.pipe(writeStream);
  } catch (error) {
    console.error('[UPLOAD ROUTE] Error handling upload:', error?.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error uploading file', details: error?.message });
    }
  }
});

// Legacy upload handler using multer (kept for backward compatibility)
router.post('/multer', upload.single('file'), async (req, res) => {
  try {
    console.log('[UPLOAD ROUTE] File upload request received (legacy)');
    
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