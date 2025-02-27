const axios = require('axios');
const FormData = require('form-data');

const TIKTOK_API_KEY = process.env.TIKTOK_API_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_ACCESS_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_VIDEO_UPLOAD_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';

// Generate TikTok OAuth URL
function getAuthUrl() {
  const redirectUri = `${process.env.BACKEND_URL}/tiktok/callback`;
  const csrfState = Math.random().toString(36).substring(2);
  
  // Include all required scopes for video posting
  // video.publish is needed for posting videos
  const scopes = [
    'user.info.basic',
    'video.upload',
    'video.publish'
  ].join(',');
  
  const authUrl = `${TIKTOK_AUTH_URL}?client_key=${TIKTOK_API_KEY}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${csrfState}`;
  
  console.log('Generated TikTok Auth URL:', authUrl);
  return authUrl;
}

// Exchange code for access token
async function getAccessToken(code) {
  try {
    console.log('Exchanging code for access token with code:', code);
    
    // Create the request body for v2 API
    const params = new URLSearchParams();
    params.append('client_key', TIKTOK_API_KEY);
    params.append('client_secret', TIKTOK_CLIENT_SECRET);
    params.append('code', code);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', `${process.env.BACKEND_URL}/tiktok/callback`);
    
    console.log('Token request params:', params.toString());
    
    const response = await axios.post(TIKTOK_ACCESS_TOKEN_URL, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    console.log('Token response:', response?.data);
    return response?.data;
  } catch (error) {
    console.error('Error getting access token:', error?.response?.data || error?.message);
    throw new Error('Failed to get access token');
  }
}

// Post video to TikTok
async function postVideo(videoUrl, accessToken) {
  try {
    console.log('Posting video to TikTok with URL:', videoUrl);
    
    // First, download the video
    const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });
    const videoBuffer = Buffer.from(videoResponse?.data || '');
    
    console.log('Downloaded video, size:', videoBuffer?.length, 'bytes');
    
    // Check if video size is within TikTok's limits
    // TikTok has minimum size requirements for videos
    if (videoBuffer?.length < 100000) {
      throw new Error('Video file is too small. TikTok requires videos of adequate size and resolution.');
    }
    
    // Initialize video upload with TikTok v2 API
    const initRequest = {
      post_info: {
        title: 'Video posted via API',
        privacy_level: 'SELF_ONLY', // Required for unaudited API clients
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl
      }
    };
    
    console.log('Sending init request:', JSON.stringify(initRequest, null, 2));
    
    const initResponse = await axios.post(TIKTOK_VIDEO_UPLOAD_URL, initRequest, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Video init response:', JSON.stringify(initResponse?.data, null, 2));
    
    // If successful, we need to check the status of the upload
    if (initResponse?.data?.data?.publish_id) {
      const publishId = initResponse?.data?.data?.publish_id;
      
      console.log('Got publish ID:', publishId);
      
      // Poll the status of the upload until it's complete or times out
      let statusResponse = null;
      let attempts = 0;
      const maxAttempts = 10; // Try up to 10 times
      let isComplete = false;
      
      while (!isComplete && attempts < maxAttempts) {
        attempts++;
        
        try {
          // Check the status of the upload
          statusResponse = await axios.post('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
            publish_id: publishId
          }, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          });
          
          console.log(`Status check attempt ${attempts}:`, JSON.stringify(statusResponse?.data, null, 2));
          
          const status = statusResponse?.data?.data?.status;
          const failReason = statusResponse?.data?.data?.fail_reason;
          const downloadedBytes = statusResponse?.data?.data?.downloaded_bytes || 0;
          
          if (status === 'PUBLISH_COMPLETE') {
            isComplete = true;
            console.log('Video upload completed successfully');
          } else if (status === 'FAILED' || status === 'PUBLISH_FAILED') {
            isComplete = true;
            console.log(`Video upload failed with reason: ${failReason || 'unknown'}`);
            
            // Handle specific failure reasons
            if (failReason === 'picture_size_check_failed') {
              throw new Error('Video dimensions or resolution not supported by TikTok. Try a video with resolution between 720x720 and 1080x1920.');
            } else if (failReason) {
              throw new Error(`Upload failed: ${failReason}`);
            }
          } else if (downloadedBytes === 0 && attempts > 5) {
            // If after several attempts TikTok hasn't started downloading the video, there might be an issue with the URL
            console.log('TikTok is not downloading the video. The URL might not be accessible or the format is not supported.');
          }
          
          // Wait 2 seconds before checking again if not complete
          if (!isComplete) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (statusError) {
          console.error(`Error checking status (attempt ${attempts}):`, statusError?.response?.data || statusError?.message);
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      if (attempts >= maxAttempts && !isComplete) {
        console.log('Video upload status polling timed out. The video may still be processing.');
        return {
          publishId,
          message: 'Video upload is still processing. Check your TikTok account later to see if it appears.'
        };
      }
      
      return {
        ...(statusResponse?.data || {}),
        publishId,
        message: statusResponse?.data?.data?.status === 'PUBLISH_COMPLETE' 
          ? 'Video uploaded successfully. It may take some time to appear on your profile.'
          : `Video upload ${statusResponse?.data?.data?.status === 'FAILED' ? 'failed: ' + (statusResponse?.data?.data?.fail_reason || 'unknown reason') : 'is still processing'}`
      };
    } else if (initResponse?.data?.error) {
      // Handle specific error codes from the init response
      const errorCode = initResponse?.data?.error?.code;
      const errorMessage = initResponse?.data?.error?.message;
      
      if (errorCode === 'unaudited_client_can_only_post_to_private_accounts') {
        console.log('Unaudited client error. This is expected during development.');
        throw new Error('Your API client is unaudited. Videos can only be posted with private visibility. Please ensure privacy_level is set to "SELF_ONLY".');
      } else if (errorCode === 'invalid_params' && errorMessage?.includes('source info')) {
        throw new Error('Invalid source_info parameter. Please check the video URL format and ensure it is publicly accessible.');
      } else {
        throw new Error(`TikTok API error: ${errorMessage || errorCode || 'Unknown error'}`);
      }
    } else {
      console.error('Failed to get publish_id from init response:', JSON.stringify(initResponse?.data, null, 2));
      throw new Error('Failed to initialize video upload');
    }
  } catch (error) {
    console.error('Error posting video:', error?.response?.data || error?.message);
    
    // Extract the most useful error message
    let errorMessage = 'Failed to post video to TikTok';
    
    if (error?.response?.data?.error?.message) {
      errorMessage += ': ' + error.response.data.error.message;
    } else if (error?.response?.data?.error?.code) {
      errorMessage += ': ' + error.response.data.error.code;
    } else if (error?.message) {
      errorMessage += ': ' + error.message;
    }
    
    throw new Error(errorMessage);
  }
}

module.exports = { getAuthUrl, getAccessToken, postVideo };