require('dotenv').config();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');
const path = require('path');

// Initialize R2 client with credentials from environment variables
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Upload a file buffer to R2 assets bucket
async function uploadAssetBuffer(fileBuffer, fileName, contentType) {
  try {
    console.log(`[AssetsService] Uploading asset: ${fileName}, type: ${contentType}, size: ${fileBuffer?.length} bytes`);
    
    // Generate a unique file name if one is not provided
    const uniqueFileName = fileName || `${Date.now()}-${Math.random().toString(36).substring(2, 15)}${path.extname(fileName || '.jpg')}`;
    
    // Upload the file to R2 assets bucket
    const uploadParams = {
      Bucket: process.env.R2_ASSETS_BUCKET_NAME, // Use the assets bucket, not videos bucket
      Key: uniqueFileName, // No need for assets/ prefix since it's already the assets bucket
      Body: fileBuffer,
      ContentType: contentType || 'image/jpeg',
    };
    
    const command = new PutObjectCommand(uploadParams);
    const response = await r2Client.send(command);
    
    console.log(`[AssetsService] Upload successful:`, response);
    
    // Generate the public URL for the uploaded file
    const fileUrl = `${process.env.R2_ASSETS_PUBLIC_DOMAIN}/${uniqueFileName}`;
    
    return {
      success: true,
      url: fileUrl,
      key: uniqueFileName,
    };
  } catch (error) {
    console.error('[AssetsService] Error uploading asset:', error?.message);
    throw new Error(`Failed to upload asset to R2: ${error?.message}`);
  }
}

// Download and upload an asset from a URL
async function uploadAssetFromUrl(url, fileName, contentType) {
  try {
    console.log(`[AssetsService] Downloading asset from URL: ${url}`);
    
    // Fetch the file from the URL with retries
    const MAX_RETRIES = 3;
    let lastError;
    
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'Accept': 'image/*,*/*',
            'User-Agent': 'Mozilla/5.0 (compatible; SocialPostApp/1.0)'
          }
        });
        
        if (!response?.data) {
          throw new Error('Empty response');
        }
        
        const fileBuffer = Buffer.from(response.data);
        console.log(`[AssetsService] Downloaded asset, size: ${fileBuffer.length} bytes`);
        
        // Upload the file to R2
        return await uploadAssetBuffer(
          fileBuffer,
          fileName || `asset-${Date.now()}${path.extname(url.split('?')[0] || '.jpg')}`,
          contentType || response?.headers?.['content-type'] || 'image/jpeg'
        );
      } catch (error) {
        console.error(`[AssetsService] Download attempt ${i + 1} failed:`, error?.message);
        lastError = error;
        
        if (i < MAX_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        }
      }
    }
    
    throw lastError || new Error('Failed to download asset after all retries');
  } catch (error) {
    console.error('[AssetsService] Error uploading asset from URL:', error?.message);
    throw new Error(`Failed to upload asset from URL: ${error?.message}`);
  }
}

module.exports = {
  uploadAssetBuffer,
  uploadAssetFromUrl
}; 