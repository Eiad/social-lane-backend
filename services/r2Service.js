const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
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

// Upload a file to R2 storage
async function uploadFile(fileBuffer, fileName, contentType) {
  try {
    console.log(`[R2Service] Uploading file: ${fileName}, type: ${contentType}, size: ${fileBuffer.length} bytes`);
    
    // Generate a unique file name if one is not provided
    const uniqueFileName = fileName || `${Date.now()}-${Math.random().toString(36).substring(2, 15)}.mp4`;
    
    // Upload the file to R2
    const uploadParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: uniqueFileName,
      Body: fileBuffer,
      ContentType: contentType || 'video/mp4',
    };
    
    const command = new PutObjectCommand(uploadParams);
    const response = await r2Client.send(command);
    
    console.log(`[R2Service] Upload successful:`, response);
    
    // Generate the public URL for the uploaded file
    const fileUrl = `${process.env.R2_MEDIA_PUBLIC_DOMAIN}/${uniqueFileName}`;
    
    return {
      success: true,
      url: fileUrl,
      key: uniqueFileName,
    };
  } catch (error) {
    console.error('[R2Service] Error uploading file:', error?.message);
    throw new Error(`Failed to upload file to R2: ${error?.message}`);
  }
}

// Upload a file from a local path to R2 storage
async function uploadFileFromPath(filePath, fileName, contentType) {
  try {
    console.log(`[R2Service] Reading file from path: ${filePath}`);
    
    // Read the file from the local path
    const fileBuffer = fs.readFileSync(filePath);
    
    // If no filename is provided, use the original filename
    const originalFileName = fileName || path.basename(filePath);
    
    // Upload the file to R2
    return await uploadFile(fileBuffer, originalFileName, contentType);
  } catch (error) {
    console.error('[R2Service] Error uploading file from path:', error?.message);
    throw new Error(`Failed to upload file from path: ${error?.message}`);
  }
}

// Download a file from a URL and upload it to R2
async function uploadFileFromUrl(url, fileName, contentType) {
  try {
    console.log(`[R2Service] Downloading file from URL: ${url}`);
    
    // Fetch the file from the URL
    const axios = require('axios');
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const fileBuffer = Buffer.from(response?.data || '');
    
    console.log(`[R2Service] Downloaded file, size: ${fileBuffer.length} bytes`);
    
    // Upload the file to R2
    return await uploadFile(fileBuffer, fileName, contentType || response?.headers?.['content-type']);
  } catch (error) {
    console.error('[R2Service] Error uploading file from URL:', error?.message);
    throw new Error(`Failed to upload file from URL: ${error?.message}`);
  }
}

// Generate a presigned URL for a file in R2 (useful for private files)
async function getPresignedUrl(key, expiresIn = 3600) {
  try {
    console.log(`[R2Service] Generating presigned URL for key: ${key}`);
    
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    });
    
    const presignedUrl = await getSignedUrl(r2Client, command, { expiresIn });
    
    return {
      success: true,
      url: presignedUrl,
      key,
    };
  } catch (error) {
    console.error('[R2Service] Error generating presigned URL:', error?.message);
    throw new Error(`Failed to generate presigned URL: ${error?.message}`);
  }
}

module.exports = {
  uploadFile,
  uploadFileFromPath,
  uploadFileFromUrl,
  getPresignedUrl,
}; 