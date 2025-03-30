const axios = require('axios');
const FormData = require('form-data');
const assetsService = require('./assetsService');

const TIKTOK_API_KEY = process.env.TIKTOK_API_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_ACCESS_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_VIDEO_UPLOAD_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

// Generate TikTok OAuth URL with state parameter for multiple accounts
function getAuthUrl({ forceLogin = false, state = '' } = {}) {
  const redirectUri = `${process.env.BACKEND_URL}/tiktok/callback`;
  
  // Include all required scopes for video posting and user info
  const scopes = [
    'user.info.basic',
    'user.info.profile',  // Add profile scope for detailed profile info
    'user.info.stats',    // Add stats scope for follower counts etc
    'video.upload',
    'video.publish'
  ].join(',');
  
  const params = new URLSearchParams({
    client_key: TIKTOK_API_KEY,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes,
    state: state
  });

  // Add force_login parameter to allow switching accounts
  if (forceLogin) {
    params.append('force_login', 'true');
  }
  
  const authUrl = `${TIKTOK_AUTH_URL}?${params.toString()}`;
  
  console.log('Generated TikTok Auth URL:', authUrl);
  console.log('Requested scopes:', scopes);
  return authUrl;
}

// Exchange code for access token
async function getAccessToken(code) {
  try {
    console.log('Exchanging code for access token with code:', code);
    
    const params = new URLSearchParams();
    params.append('client_key', TIKTOK_API_KEY);
    params.append('client_secret', TIKTOK_CLIENT_SECRET);
    params.append('code', code);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', `${process.env.BACKEND_URL}/tiktok/callback`);
    
    console.log('Token request params:', params.toString());
    
    const response = await axios.post(TIKTOK_ACCESS_TOKEN_URL, params.toString(), {
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

// Refresh an expired TikTok access token using refresh token
async function refreshTikTokToken(refreshToken) {
  try {
    console.log('Attempting to refresh TikTok access token');
    
    if (!refreshToken) {
      throw new Error('No refresh token provided');
    }
    
    const params = new URLSearchParams();
    params.append('client_key', TIKTOK_API_KEY);
    params.append('client_secret', TIKTOK_CLIENT_SECRET);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    
    console.log('Token refresh params:', params.toString().replace(refreshToken, '[REDACTED]'));
    
    const response = await axios.post(TIKTOK_ACCESS_TOKEN_URL, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000 // 30 second timeout
    });
    
    console.log('Token refresh response:', JSON.stringify({
      ...response?.data,
      access_token: response?.data?.access_token ? '[REDACTED]' : undefined,
      refresh_token: response?.data?.refresh_token ? '[REDACTED]' : undefined
    }));
    
    if (!response?.data?.access_token) {
      throw new Error('No access token in refresh response');
    }
    
    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || refreshToken, // Use new refresh token if provided
      openId: response.data.open_id,
      scope: response.data.scope,
      expiresIn: response.data.expires_in
    };
  } catch (error) {
    console.error('Error refreshing TikTok token:', error?.response?.data || error?.message);
    
    // Enhanced error handling for refresh token failures
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      throw new Error('Refresh token is invalid or expired. Please reconnect your TikTok account.');
    }
    
    if (error?.response?.data?.error_description) {
      throw new Error(`Failed to refresh TikTok access token: ${error.response.data.error_description}`);
    }
    
    throw new Error('Failed to refresh TikTok access token: ' + (error?.response?.data?.error?.message || error?.message));
  }
}

// Post video to TikTok with support for multiple accounts
async function postVideo(videoUrl, accessToken, caption = '', refreshToken = '') {
  try {
    // Check if we need to refresh the token
    let tokenToUse = accessToken;
    let attemptedRefresh = false;
    
    // First, download the video
    console.log('Attempting to download video from URL...');
    let videoBuffer;
    
    try {
      console.log('Making HTTP request to download video from:', videoUrl);
      
      const videoResponse = await axios.get(videoUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        validateStatus: status => status >= 200 && status < 300
      });
      
      console.log('Video download response status:', videoResponse?.status);
      console.log('Video download response headers:', JSON.stringify(videoResponse?.headers || {}, null, 2));
      
      if (!videoResponse?.data) {
        console.error('Video download response has no data');
        throw new Error('Video download failed: Empty response');
      }
      
      videoBuffer = Buffer.from(videoResponse?.data);
      
      console.log('Downloaded video, size:', videoBuffer?.length, 'bytes');
      
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
      }
      
      throw new Error(`Failed to download video: ${downloadError?.message}`);
    }
    
    // Add a delay to ensure the video is fully processed
    console.log('Adding a 2-second delay before posting to TikTok...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Initialize video upload with TikTok v2 API
    const DEFAULT_CAPTION = 'Video posted via API';
    let finalCaption = typeof caption === 'string' && caption.trim() ? caption.trim() : DEFAULT_CAPTION;
    
    const initRequest = {
      post_info: {
        title: finalCaption,
        description: finalCaption,
        privacy_level: 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 0
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl
      }
    };

    async function attemptUploadWithToken(token, rToken) {
      console.log('Initializing video upload with TikTok API...');
      console.log('Using access token:', !!token);
      console.log('Using refresh token:', !!rToken);
      
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      
      if (rToken) {
        headers['X-Refresh-Token'] = rToken;
      }
      
      return await axios.post(TIKTOK_VIDEO_UPLOAD_URL, initRequest, {
        headers,
        timeout: 60000
      });
    }

    let initResponse;
    try {
      initResponse = await attemptUploadWithToken(tokenToUse, refreshToken);
      
      // Safely log and parse the response
      try {
        if (initResponse?.data) {
          console.log('Video init response from TikTok:', JSON.stringify(initResponse?.data, null, 2));
        } else {
          console.log('Video init response from TikTok: [empty data]');
        }
      } catch (logError) {
        console.error('Error logging response:', logError?.message);
      }
    } catch (initError) {
      // Check if this is an expired token error and we have a refresh token
      const isExpiredTokenError = 
        initError?.response?.data?.error?.code === 'access_token_has_expired' || 
        (initError?.message && initError?.message.includes('expired')) ||
        (initError?.response?.data?.error?.message && 
         initError?.response?.data?.error?.message.includes('invalid'));
      
      if (isExpiredTokenError && refreshToken && !attemptedRefresh) {
        console.log('Access token expired or invalid. Attempting to refresh token...');
        try {
          // Try to refresh the token
          const newTokens = await refreshTikTokToken(refreshToken);
          attemptedRefresh = true;
          
          console.log('Successfully refreshed tokens. Retrying upload with new token...');
          // Retry the upload with new token
          initResponse = await attemptUploadWithToken(newTokens.accessToken, newTokens.refreshToken);
          
          // If successful, update the token to use
          tokenToUse = newTokens.accessToken;
          refreshToken = newTokens.refreshToken;
          
          // Log success
          console.log('Upload successful with refreshed token');
        } catch (refreshError) {
          console.error('Failed to refresh token:', refreshError?.message);
          // Continue with the original error handling
          handleTikTokError(initError);
        }
      } else {
        // For non-token errors or if refresh failed, continue with error handling
        // Check if the response is HTML or other non-JSON format
        if (initError?.response?.headers?.['content-type']?.includes('text/html')) {
          console.error('=== TikTok returned HTML instead of JSON ===');
          const htmlResponse = initError?.response?.data?.toString().substring(0, 500);
          console.error('HTML Response (first 500 chars):', htmlResponse);
          throw new Error('TikTok API returned HTML instead of JSON. Please check your TikTok credentials or try again later.');
        }
        
        // Try to safely handle the error response
        try {
          handleTikTokError(initError);
        } catch (handleError) {
          console.error('Error handling TikTok API error:', handleError?.message);
          throw new Error('Failed to process TikTok API error: ' + (handleError?.message || initError?.message));
        }
      }
    }
    
    if (initResponse?.data?.data?.publish_id) {
      const result = await handleVideoUploadStatus(initResponse.data.data.publish_id, tokenToUse, refreshToken);
      
      // If we refreshed tokens during this operation, include that info in the result
      if (attemptedRefresh) {
        result.tokensRefreshed = true;
        result.newAccessToken = tokenToUse;
        result.newRefreshToken = refreshToken;
      }
      
      return result;
    } else if (initResponse?.data?.error) {
      try {
        handleTikTokError(new Error(initResponse.data.error.message || initResponse.data.error.code));
      } catch (handleError) {
        console.error('Error handling TikTok API error from response:', handleError?.message);
        throw new Error('TikTok API error: ' + (initResponse?.data?.error?.message || initResponse?.data?.error?.code));
      }
    } else {
      console.error('Failed to get publish_id from init response:', JSON.stringify(initResponse?.data, null, 2));
      throw new Error('Failed to initialize video upload');
    }
  } catch (error) {
    console.error('=== TIKTOK POSTING ERROR ===');
    console.error('Error posting video:', error?.message);
    console.error('Error stack:', error?.stack);
    throw error;
  }
}

// Replace the existing handleTikTokError function with an improved version that better handles token errors
function handleTikTokError(error) {
  console.error('=== TIKTOK API ERROR ===');
  console.error('Error:', error?.message);
  
  if (error?.response?.data?.error) {
    const errorCode = error.response.data.error.code;
    const errorMessage = error.response.data.error.message;
    
    console.log('TikTok API error code:', errorCode);
    console.log('TikTok API error message:', errorMessage);
    
    // Handle specific known error cases
    if (errorCode === 'unaudited_client_can_only_post_to_private_accounts') {
      throw new Error('Your API client is unaudited. Videos can only be posted with private visibility.');
    } else if (errorCode === 'invalid_params' && errorMessage?.includes('source info')) {
      throw new Error('Invalid source_info parameter. Please check the video URL format and ensure it is publicly accessible.');
    } else if (errorCode === 'access_token_has_expired' || errorCode === 'token_has_expired') {
      throw new Error('Your TikTok access token has expired. Please reconnect your TikTok account.');
    } else if (errorCode === 'invalid_access_token' || errorCode?.includes('invalid_token') || errorMessage?.includes('invalid token')) {
      throw new Error('TikTok authorization invalid. Please reconnect your TikTok account.');
    } else if (errorCode === 'invalid_refresh_token' || errorMessage?.includes('refresh token')) {
      throw new Error('TikTok refresh token is invalid. Please reconnect your TikTok account.');
    } else {
      throw new Error(`TikTok API error: ${errorMessage || errorCode}`);
    }
  } else if (error?.message?.includes('access token has expired') || 
             error?.message?.includes('token expired') ||
             error?.message?.toLowerCase().includes('invalid token')) {
    throw new Error('TikTok authorization invalid. Please reconnect your TikTok account.');
  }
  
  throw error;
}

// Helper function to handle video upload status checks
async function handleVideoUploadStatus(publishId, accessToken, refreshToken) {
  let statusResponse = null;
  let attempts = 0;
  const maxAttempts = 10;
  let isComplete = false;
  
  while (!isComplete && attempts < maxAttempts) {
    attempts++;
    
    try {
      console.log(`Checking upload status, attempt ${attempts}/${maxAttempts}...`);
      
      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      };
      
      if (refreshToken) {
        headers['X-Refresh-Token'] = refreshToken;
      }
      
      statusResponse = await axios.post('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
        publish_id: publishId
      }, {
        headers,
        timeout: 30000
      });
      
      console.log(`Status check attempt ${attempts}:`, JSON.stringify(statusResponse?.data, null, 2));
      
      const status = statusResponse?.data?.data?.status;
      const failReason = statusResponse?.data?.data?.fail_reason;
      
      if (status === 'PUBLISH_COMPLETE') {
        isComplete = true;
        console.log('Video upload completed successfully');
      } else if (status === 'FAILED' || status === 'PUBLISH_FAILED') {
        isComplete = true;
        handleUploadFailure(failReason);
      }
      
      if (!isComplete) {
        console.log('Waiting 2 seconds before next status check...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (statusError) {
      console.error(`=== STATUS CHECK ERROR (attempt ${attempts}) ===`);
      console.error('Error checking status:', statusError?.message);
      
      if (attempts >= maxAttempts) {
        throw new Error(`Failed to check upload status: ${statusError?.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  if (attempts >= maxAttempts && !isComplete) {
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
}

// Helper function to handle upload failures
function handleUploadFailure(failReason) {
  if (failReason === 'picture_size_check_failed') {
    throw new Error('Video dimensions or resolution not supported by TikTok. Try a video with resolution between 720x720 and 1080x1920.');
  } else if (failReason === 'download_timeout') {
    throw new Error('TikTok could not download the video in time. Please ensure the video URL is publicly accessible and try again.');
  } else if (failReason === 'download_failed') {
    throw new Error('TikTok failed to download the video. Please ensure the video URL is publicly accessible and try again.');
  } else if (failReason) {
    throw new Error(`Upload failed: ${failReason}`);
  }
}

// Get TikTok user info
async function getUserInfo(accessToken, refreshToken = '') {
  try {
    console.log('Fetching TikTok user info with access token:', !!accessToken);
    console.log('Refresh token provided:', !!refreshToken);
    
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    
    if (refreshToken) {
      headers['X-Refresh-Token'] = refreshToken;
    }
    
    // Specify fields parameter to ensure we get all required user information
    const fields = [
      'open_id',
      'union_id',
      'avatar_url',
      'avatar_url_100',
      'display_name',
      'bio_description',
      'profile_deep_link',
      'is_verified',
      'follower_count',
      'following_count',
      'likes_count',
      'username'
    ];
    
    try {
      console.log('Attempting to fetch user info with fields:', fields.join(','));
      const response = await axios.get(`${TIKTOK_USER_INFO_URL}?fields=${fields.join(',')}`, { headers });
      
      console.log('User info response:', response?.data);
      
      // Extract and validate user data
      const userData = response?.data?.data?.user;
      if (userData) {
        // Log available fields for debugging
        console.log('TikTok user data retrieved:', {
          has_username: !!userData.username,
          has_avatar_url: !!userData.avatar_url,
          has_avatar_url_100: !!userData.avatar_url_100,
          has_display_name: !!userData.display_name
        });

        // Upload only the avatar_url_100 to R2
        let r2AvatarUrl100 = null;

        if (userData.avatar_url_100) {
          try {
            console.log('Uploading avatar_url_100 to R2:', userData.avatar_url_100);
            const result = await assetsService.uploadAssetFromUrl(
              userData.avatar_url_100,
              `tiktok-avatar-100-${userData.open_id}-${Date.now()}.jpg`
            );
            r2AvatarUrl100 = result.url;
            console.log('Avatar 100 uploaded to R2:', r2AvatarUrl100);
          } catch (error) {
            console.error('Error uploading avatar_100 to R2:', error?.message);
            // Fall back to original URL if upload fails
            r2AvatarUrl100 = userData.avatar_url_100;
          }
        } else if (userData.avatar_url) {
          // Only if avatar_url_100 is not available, use avatar_url as fallback
          try {
            console.log('avatar_url_100 not available, uploading avatar_url to R2:', userData.avatar_url);
            const result = await assetsService.uploadAssetFromUrl(
              userData.avatar_url,
              `tiktok-avatar-${userData.open_id}-${Date.now()}.jpg`
            );
            r2AvatarUrl100 = result.url;
            console.log('Avatar uploaded to R2:', r2AvatarUrl100);
          } catch (error) {
            console.error('Error uploading avatar to R2:', error?.message);
            // Fall back to original URL if upload fails
            r2AvatarUrl100 = userData.avatar_url;
          }
        }
        
        // Return cleaned user data with all required fields
        return {
          username: userData.username || '',
          display_name: userData.display_name || userData.username || '',
          
          // Keep original TikTok avatar_url (do not upload to R2)
          avatar_url: userData.avatar_url || '',
          avatarUrl: userData.avatar_url || '',
          
          // Only use R2 for avatarUrl100 and avatar_url_100
          avatarUrl100: r2AvatarUrl100 || userData.avatar_url_100 || userData.avatar_url || '',
          avatar_url_100: r2AvatarUrl100 || userData.avatar_url_100 || userData.avatar_url || '',
          
          bio_description: userData.bio_description || '',
          profile_deep_link: userData.profile_deep_link || '',
          is_verified: userData.is_verified || false,
          follower_count: userData.follower_count || 0,
          following_count: userData.following_count || 0,
          likes_count: userData.likes_count || 0,
          open_id: userData.open_id || '',
          union_id: userData.union_id || ''
        };
      }
      
      throw new Error('No user data in response');
    } catch (error) {
      // If first attempt fails due to scope issues, try with minimal fields
      if (error?.response?.data?.error?.code === 'scope_not_authorized') {
        console.log('Scope not authorized for comprehensive fields. Trying with basic fields only.');
        // Retry with only basic fields that should be available with user.info.basic scope
        const basicFields = ['open_id', 'avatar_url', 'display_name', 'username'];
        
        const retryResponse = await axios.get(`${TIKTOK_USER_INFO_URL}?fields=${basicFields.join(',')}`, { headers });
        console.log('Basic user info response:', retryResponse?.data);
        
        const basicUserData = retryResponse?.data?.data?.user;
        if (basicUserData) {
          // Upload avatar URL to R2 if it exists
          let r2AvatarUrl = null;
          if (basicUserData.avatar_url) {
            try {
              console.log('Uploading basic avatar_url to R2:', basicUserData.avatar_url);
              const result = await assetsService.uploadAssetFromUrl(
                basicUserData.avatar_url,
                `tiktok-avatar-${basicUserData.open_id}-${Date.now()}.jpg`
              );
              r2AvatarUrl = result.url;
              console.log('Basic avatar uploaded to R2:', r2AvatarUrl);
            } catch (error) {
              console.error('Error uploading basic avatar to R2:', error?.message);
              // Fall back to original URL if upload fails
              r2AvatarUrl = basicUserData.avatar_url;
            }
          }

          return {
            username: basicUserData.username || '',
            display_name: basicUserData.display_name || '',
            
            // Keep original avatar_url
            avatar_url: basicUserData.avatar_url || '',
            avatarUrl: basicUserData.avatar_url || '',
            
            // Only use R2 URL for avatarUrl100
            avatarUrl100: r2AvatarUrl || basicUserData.avatar_url || '',
            avatar_url_100: r2AvatarUrl || basicUserData.avatar_url || '',
            
            open_id: basicUserData.open_id || ''
          };
        }
      }
      
      // If it's not a scope issue or retry failed, create minimal user object
      console.log('Unable to fetch user info. Creating minimal user object.');
      return {
        username: 'TikTok User',
        display_name: 'TikTok User',
        avatarUrl: null,
        avatarUrl100: null,
        avatar_url: null,
        avatar_url_100: null,
        open_id: ''
      };
    }
  } catch (error) {
    console.error('Error getting user info:', error?.response?.data || error?.message);
    throw new Error('Failed to get user info');
  }
}

module.exports = { getAuthUrl, getAccessToken, refreshTikTokToken, postVideo, getUserInfo };