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
  
  const authUrl = `${TIKTOK_AUTH_URL}?client_key=${TIKTOK_API_KEY}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user.info.basic,video.upload&state=${csrfState}`;
  
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
    console.error('Error getting access token:', error?.response?.data || error.message);
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
    
    console.log('Downloaded video, size:', videoBuffer.length, 'bytes');
    
    // Initialize video upload with TikTok v2 API
    const initResponse = await axios.post(TIKTOK_VIDEO_UPLOAD_URL, {
      post_info: {
        title: 'Video posted via API',
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false
      }
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Video init response:', initResponse?.data);
    
    // If successful, we need to upload the actual video file
    if (initResponse?.data?.data?.publish_id) {
      const publishId = initResponse.data.data.publish_id;
      const uploadUrl = initResponse.data.data.upload_url;
      
      // Upload the video to the provided URL
      const uploadResponse = await axios.put(uploadUrl, videoBuffer, {
        headers: {
          'Content-Type': 'video/mp4'
        }
      });
      
      console.log('Video upload response status:', uploadResponse?.status);
      
      // Complete the upload
      const completeResponse = await axios.post('https://open.tiktokapis.com/v2/post/publish/video/status/', {
        publish_id: publishId
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('Video publish complete response:', completeResponse?.data);
      return completeResponse?.data;
    }
    
    return initResponse?.data;
  } catch (error) {
    console.error('Error posting video:', error?.response?.data || error.message);
    throw new Error('Failed to post video to TikTok');
  }
}

module.exports = { getAuthUrl, getAccessToken, postVideo };