const express = require('express');
const router = express.Router();
const assetsService = require('../services/assetsService');

// Handle URL uploads (download from URL and upload to R2 assets bucket)
router.post('/from-url', express.json(), async (req, res) => {
  try {
    console.log('[ASSETS ROUTE] URL upload request received');
    
    const { url, fileName } = req?.body || {};
    
    if (!url) {
      console.error('[ASSETS ROUTE] No URL provided');
      return res.status(400).json({ error: 'URL is required' });
    }
    
    console.log('[ASSETS ROUTE] URL upload details:', {
      url,
      fileName: fileName || '(auto-generated)'
    });
    
    // Download from URL and upload to R2 assets bucket
    const result = await assetsService.uploadAssetFromUrl(url, fileName);
    
    console.log('[ASSETS ROUTE] R2 upload result:', result);
    
    // Return the R2 URL
    res.status(200).json({
      success: true,
      url: result.url,
      key: result.key
    });
  } catch (error) {
    console.error('[ASSETS ROUTE] Error handling URL upload:', error?.message);
    console.error('[ASSETS ROUTE] Full error:', error);
    console.error('[ASSETS ROUTE] Stack trace:', error?.stack);
    res.status(500).json({ error: 'Error uploading from URL', details: error?.message });
  }
});

module.exports = router; 