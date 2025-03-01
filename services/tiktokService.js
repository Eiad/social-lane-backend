const axios = require('axios');
const FormData = require('form-data');

const TIKTOK_API_KEY = process.env.TIKTOK_API_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_ACCESS_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_VIDEO_UPLOAD_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

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
    console.log('=== TIKTOK POSTING PROCESS START ===');
    console.log('Posting video to TikTok with URL:', videoUrl);
    console.log('Access token available:', !!accessToken);
    
    // First, download the video
    console.log('Attempting to download video from URL...');
    let videoBuffer;
    
    try {
      console.log('Making HTTP request to download video from:', videoUrl);
      
      // Add timeout to prevent hanging on inaccessible URLs
      const videoResponse = await axios.get(videoUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000, // 30 second timeout
        validateStatus: status => status >= 200 && status < 300 // Only accept 2xx status codes
      });
      
      console.log('Video download response status:', videoResponse?.status);
      console.log('Video download response headers:', JSON.stringify(videoResponse?.headers || {}, null, 2));
      
      if (!videoResponse?.data) {
        console.error('Video download response has no data');
        throw new Error('Video download failed: Empty response');
      }
      
      videoBuffer = Buffer.from(videoResponse?.data);
      
      console.log('Downloaded video, size:', videoBuffer?.length, 'bytes');
      
      // Check if video size is within TikTok's limits
      // TikTok has minimum size requirements for videos
      if (!videoBuffer?.length) {
        console.error('Video buffer is empty or undefined');
        throw new Error('Video file is empty. Please check the URL and try again.');
      }
      
      if (videoBuffer?.length < 100000) {
        console.log('Video file too small:', videoBuffer?.length, 'bytes');
        throw new Error('Video file is too small. TikTok requires videos of adequate size and resolution.');
      }
    } catch (downloadError) {
      console.error('=== VIDEO DOWNLOAD ERROR ===');
      console.error('Error downloading video:', downloadError?.message);
      
      if (downloadError?.response) {
        console.error('Error response status:', downloadError.response.status);
        console.error('Error response headers:', JSON.stringify(downloadError.response.headers || {}, null, 2));
        
        // Log the first 100 bytes of the error response if available
        if (downloadError.response.data) {
          let errorData = downloadError.response.data;
          if (Buffer.isBuffer(errorData)) {
            try {
              errorData = errorData.toString('utf8').substring(0, 200);
            } catch (e) {
              errorData = 'Binary data';
            }
          }
          console.error('Error response data (first 200 chars):', errorData);
        }
      } else if (downloadError?.request) {
        console.error('No response received from server');
        console.error('Request details:', downloadError.request._currentUrl || downloadError.request.path);
      }
      
      // Check if the URL is accessible
      try {
        console.log('Checking if URL is publicly accessible...');
        const headResponse = await axios.head(videoUrl, { timeout: 5000 });
        console.log('URL is accessible, status:', headResponse.status);
        console.log('Content type:', headResponse.headers['content-type']);
        console.log('Content length:', headResponse.headers['content-length']);
      } catch (headError) {
        console.error('URL accessibility check failed:', headError.message);
        throw new Error(`Video URL is not publicly accessible: ${headError.message}`);
      }
      
      throw new Error(`Failed to download video: ${downloadError?.message}`);
    }
    
    // Add a delay to ensure the video is fully processed and available
    console.log('Adding a 2-second delay before posting to TikTok...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
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
    
    console.log('Sending init request to TikTok API:', JSON.stringify(initRequest, null, 2));
    
    let initResponse;
    try {
      initResponse = await axios.post(TIKTOK_VIDEO_UPLOAD_URL, initRequest, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });
      
      console.log('Video init response from TikTok:', JSON.stringify(initResponse?.data, null, 2));
    } catch (initError) {
      console.error('=== TIKTOK API INIT ERROR ===');
      console.error('Error initializing video upload:', initError?.message);
      
      if (initError?.response) {
        console.error('TikTok API error status:', initError.response.status);
        console.error('TikTok API error headers:', JSON.stringify(initError.response.headers || {}, null, 2));
        console.error('TikTok API error data:', JSON.stringify(initError.response.data || {}, null, 2));
        
        // Handle specific TikTok API error codes
        if (initError.response.data?.error?.code) {
          const errorCode = initError.response.data.error.code;
          const errorMessage = initError.response.data.error.message;
          
          if (errorCode === 'unaudited_client_can_only_post_to_private_accounts') {
            throw new Error('Your API client is unaudited. Videos can only be posted with private visibility.');
          } else if (errorCode === 'invalid_params' && errorMessage?.includes('source info')) {
            throw new Error('Invalid source_info parameter. Please check the video URL format and ensure it is publicly accessible.');
          } else if (errorCode === 'access_token_has_expired') {
            throw new Error('Your TikTok access token has expired. Please reconnect your TikTok account.');
          } else {
            throw new Error(`TikTok API error: ${errorMessage || errorCode}`);
          }
        }
      }
      
      throw new Error(`Failed to initialize video upload: ${initError?.message}`);
    }
    
    // If successful, we need to check the status of the upload
    if (initResponse?.data?.data?.publish_id) {
      const publishId = initResponse?.data?.data?.publish_id;
      
      console.log('Got publish ID from TikTok:', publishId);
      
      // Poll the status of the upload until it's complete or times out
      let statusResponse = null;
      let attempts = 0;
      const maxAttempts = 10; // Try up to 10 times
      let isComplete = false;
      
      while (!isComplete && attempts < maxAttempts) {
        attempts++;
        
        try {
          // Check the status of the upload
          console.log(`Checking upload status, attempt ${attempts}/${maxAttempts}...`);
          
          statusResponse = await axios.post('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
            publish_id: publishId
          }, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000 // 15 second timeout
          });
          
          console.log(`Status check attempt ${attempts}:`, JSON.stringify(statusResponse?.data, null, 2));
          
          const status = statusResponse?.data?.data?.status;
          const failReason = statusResponse?.data?.data?.fail_reason;
          const downloadedBytes = statusResponse?.data?.data?.downloaded_bytes || 0;
          const totalBytes = statusResponse?.data?.data?.total_bytes || 0;
          
          // Log download progress if available
          if (totalBytes > 0) {
            const progressPercent = Math.round((downloadedBytes / totalBytes) * 100);
            console.log(`Download progress: ${progressPercent}% (${downloadedBytes}/${totalBytes} bytes)`);
          }
          
          if (status === 'PUBLISH_COMPLETE') {
            isComplete = true;
            console.log('Video upload completed successfully');
          } else if (status === 'FAILED' || status === 'PUBLISH_FAILED') {
            isComplete = true;
            console.log(`Video upload failed with reason: ${failReason || 'unknown'}`);
            
            // Handle specific failure reasons
            if (failReason === 'picture_size_check_failed') {
              throw new Error('Video dimensions or resolution not supported by TikTok. Try a video with resolution between 720x720 and 1080x1920.');
            } else if (failReason === 'download_timeout') {
              throw new Error('TikTok could not download the video in time. Please ensure the video URL is publicly accessible and try again.');
            } else if (failReason === 'download_failed') {
              throw new Error('TikTok failed to download the video. Please ensure the video URL is publicly accessible and try again.');
            } else if (failReason) {
              throw new Error(`Upload failed: ${failReason}`);
            }
          } else if (downloadedBytes === 0 && attempts > 5) {
            // If after several attempts TikTok hasn't started downloading the video, there might be an issue with the URL
            console.log('TikTok is not downloading the video. The URL might not be accessible or the format is not supported.');
            
            if (attempts === maxAttempts) {
              throw new Error('TikTok could not download the video after multiple attempts. Please check if the URL is publicly accessible.');
            }
          }
          
          // Wait 2 seconds before checking again if not complete
          if (!isComplete) {
            console.log('Waiting 2 seconds before next status check...');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (statusError) {
          console.error(`=== STATUS CHECK ERROR (attempt ${attempts}) ===`);
          console.error('Error checking status:', statusError?.message);
          
          if (statusError?.response) {
            console.error('Status check error response:', JSON.stringify(statusError.response.data || {}, null, 2));
          }
          
          // Wait before retrying
          console.log('Waiting 2 seconds before retrying status check...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // If this is the last attempt, throw the error
          if (attempts >= maxAttempts) {
            throw new Error(`Failed to check upload status: ${statusError?.message}`);
          }
        }
      }
      
      if (attempts >= maxAttempts && !isComplete) {
        console.log('Video upload status polling timed out. The video may still be processing.');
        return {
          publishId,
          message: 'Video upload is still processing. Check your TikTok account later to see if it appears.'
        };
      }
      
      console.log('=== TIKTOK POSTING PROCESS COMPLETE ===');
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
    console.error('=== TIKTOK POSTING ERROR ===');
    console.error('Error posting video:', error?.message);
    console.error('Error stack:', error?.stack);
    
    // Extract the most useful error message
    let errorMessage = 'Failed to post video to TikTok';
    
    if (error?.response?.data?.error?.message) {
      errorMessage += ': ' + error.response.data.error.message;
      console.error('TikTok API error message:', error.response.data.error.message);
    } else if (error?.response?.data?.error?.code) {
      errorMessage += ': ' + error.response.data.error.code;
      console.error('TikTok API error code:', error.response.data.error.code);
    } else if (error?.message) {
      errorMessage += ': ' + error.message;
    }
    
    // Log additional debug information
    if (videoUrl) {
      console.error('Video URL that failed:', videoUrl);
      
      // Try to check if the URL is accessible
      try {
        console.log('Performing final URL accessibility check...');
        const headCheck = await axios.head(videoUrl, { 
          timeout: 5000,
          validateStatus: () => true // Accept any status code
        });
        console.log('URL final check status:', headCheck.status);
        console.log('URL content type:', headCheck.headers['content-type']);
      } catch (finalCheckError) {
        console.error('Final URL check failed:', finalCheckError.message);
      }
    }
    
    console.error('=== END OF TIKTOK POSTING ERROR ===');
    throw new Error(errorMessage);
  }
}

// Get TikTok user info
async function getUserInfo(accessToken) {
  try {
    console.log('Fetching TikTok user info with access token:', !!accessToken);
    
    const response = await axios.get(TIKTOK_USER_INFO_URL, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('User info response:', response?.data);
    return response?.data?.data?.user;
  } catch (error) {
    console.error('Error getting user info:', error?.response?.data || error?.message);
    throw new Error('Failed to get user info');
  }
}

module.exports = { getAuthUrl, getAccessToken, postVideo, getUserInfo };