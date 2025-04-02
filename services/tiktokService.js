// File: services/tiktokService.js
const axios = require('axios');
const FormData = require('form-data');
const assetsService = require('./assetsService');
const userService = require('./userService'); // Import user service

const TIKTOK_API_KEY = process.env.TIKTOK_API_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_ACCESS_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_VIDEO_UPLOAD_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

// --- getAuthUrl, getAccessToken, refreshTikTokToken, getUserInfo remain the same ---
// --- (Code for those functions omitted for brevity, but keep them in your actual file) ---

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
    console.log('[TIKTOK SERVICE] Attempting to refresh TikTok access token');

    if (!refreshToken) {
      console.error('[TIKTOK SERVICE] No refresh token provided for refresh attempt.');
      throw new Error('No refresh token provided');
    }

    const params = new URLSearchParams();
    params.append('client_key', TIKTOK_API_KEY);
    params.append('client_secret', TIKTOK_CLIENT_SECRET);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    console.log('[TIKTOK SERVICE] Token refresh request params (refresh token redacted):', params.toString().replace(refreshToken, '[REDACTED]'));

    const response = await axios.post(TIKTOK_ACCESS_TOKEN_URL, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000 // 30 second timeout
    });

     // Log the response structure carefully
    console.log('[TIKTOK SERVICE] Token refresh raw response status:', response?.status);
    console.log('[TIKTOK SERVICE] Token refresh raw response headers:', response?.headers);
     // Log only keys and types from data to avoid exposing sensitive info if structure is unexpected
    if (response?.data) {
         console.log('[TIKTOK SERVICE] Token refresh response data keys:', Object.keys(response.data));
         console.log('[TIKTOK SERVICE] Token refresh response data types:', Object.keys(response.data).map(key => `${key}: ${typeof response.data[key]}`));
     } else {
         console.warn('[TIKTOK SERVICE] Token refresh response data is empty or undefined.');
     }


    if (!response?.data?.access_token) {
      console.error('[TIKTOK SERVICE] No access_token found in refresh response data.');
      // Log the error field if present
       if(response?.data?.error) {
           console.error('[TIKTOK SERVICE] Error in refresh response:', response.data.error, response.data.error_description);
           throw new Error(`Failed to refresh TikTok token: ${response.data.error_description || response.data.error}`);
       }
      throw new Error('No access token received in refresh response');
    }

    console.log('[TIKTOK SERVICE] Successfully refreshed TikTok access token.');

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || refreshToken, // Use new refresh token if provided
      openId: response.data.open_id,
      scope: response.data.scope,
      expiresIn: response.data.expires_in,
      refreshExpiresIn: response.data.refresh_expires_in // Capture refresh token expiry too
    };
  } catch (error) {
    console.error('[TIKTOK SERVICE] Error refreshing TikTok token:', error?.response?.data || error?.message);

    // Enhanced error handling for refresh token failures
    if (error?.response?.status === 400 || error?.response?.status === 401 || error?.response?.status === 403 || error?.response?.data?.error === 'invalid_grant') {
       console.error('[TIKTOK SERVICE] Refresh token is likely invalid or expired. User needs to reconnect.');
      throw new Error('Refresh token is invalid or expired. Please reconnect your TikTok account.');
    }

    if (error?.response?.data?.error_description) {
      throw new Error(`Failed to refresh TikTok access token: ${error.response.data.error_description}`);
    }

    throw new Error('Failed to refresh TikTok access token: ' + (error?.response?.data?.error?.message || error?.message || 'Unknown error'));
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
      'username' // Request username field
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
            r2AvatarUrl100 = result.url; // Use the same variable for consistency
            console.log('Avatar uploaded to R2:', r2AvatarUrl100);
          } catch (error) {
            console.error('Error uploading avatar to R2:', error?.message);
            // Fall back to original URL if upload fails
            r2AvatarUrl100 = userData.avatar_url;
          }
        }

        // Return cleaned user data with all required fields
         const finalUserData = {
            username: userData.username || '', // Use username if available
            display_name: userData.display_name || userData.username || '', // Fallback to username
            avatar_url: userData.avatar_url || '', // Original URL
            avatar_url_100: r2AvatarUrl100 || '', // R2 URL
            bio_description: userData.bio_description || '',
            profile_deep_link: userData.profile_deep_link || '',
            is_verified: userData.is_verified || false,
            follower_count: userData.follower_count || 0,
            following_count: userData.following_count || 0,
            likes_count: userData.likes_count || 0,
            open_id: userData.open_id || '',
            union_id: userData.union_id || '',
             // Also add the R2 URL under the expected keys for compatibility
            avatarUrl: userData.avatar_url || '',
            avatarUrl100: r2AvatarUrl100 || ''
        };
         console.log("Final user data being returned from getUserInfo:", finalUserData);
         return finalUserData;
      }

      throw new Error('No user data in response');
    } catch (error) {
      // If first attempt fails due to scope issues, try with minimal fields
      if (error?.response?.data?.error?.code === 'scope_not_authorized' || error?.response?.status === 403) {
        console.log('Scope not authorized for comprehensive fields. Trying with basic fields only.');
        // Retry with only basic fields that should be available with user.info.basic scope
        const basicFields = ['open_id', 'avatar_url', 'display_name', 'username']; // Add username here too

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

          // Return minimal data
          const minimalUserData = {
            username: basicUserData.username || '', // Include username
            display_name: basicUserData.display_name || basicUserData.username || '',
            avatar_url: basicUserData.avatar_url || '',
            avatar_url_100: r2AvatarUrl || '', // Use R2 URL
            open_id: basicUserData.open_id || '',
             // Add compatibility keys
            avatarUrl: basicUserData.avatar_url || '',
            avatarUrl100: r2AvatarUrl || ''
          };
           console.log("Minimal user data being returned from getUserInfo:", minimalUserData);
           return minimalUserData;
        }
      }

      // If it's not a scope issue or retry failed, re-throw the original error
      throw error;
    }
  } catch (error) {
    console.error('Error getting user info:', error?.response?.data || error?.message);
    // Check if it's an expired token error
    if (error?.response?.data?.error?.code === 'access_token_invalid' || error?.message?.includes('expired')) {
        throw new Error('TikTok access token has expired or is invalid.'); // Throw specific error
    }
    throw new Error('Failed to get user info');
  }
}


/**
 * Posts a video to TikTok. Handles token refresh automatically if needed.
 * @param {string} videoUrl - Publicly accessible URL of the video.
 * @param {string} accessToken - User's TikTok access token.
 * @param {string} [caption=''] - Video caption.
 * @param {string} [refreshToken=''] - User's TikTok refresh token.
 * @returns {Promise<object>} - Result of the posting process, including refreshed tokens if applicable.
 */
async function postVideo(videoUrl, accessToken, caption = '', refreshToken = '') {
  let currentAccessToken = accessToken;
  let currentRefreshToken = refreshToken;
  let attemptedRefresh = false;
  let tokensRefreshed = false;
  let newAccessToken = null;
  let newRefreshToken = null;

  console.log('[TIKTOK SERVICE - postVideo] Starting video post process.');
  console.log(`[TIKTOK SERVICE - postVideo] Initial tokens: AccessToken exists: ${!!currentAccessToken}, RefreshToken exists: ${!!currentRefreshToken}`);

  // Function to perform the actual API call
  const attemptTikTokPost = async (tokenToUse) => {
    console.log(`[TIKTOK SERVICE - postVideo] Attempting TikTok API call with token.`);

     // Download video - ensure this happens *before* API init call
     let videoBuffer;
     try {
         console.log('[TIKTOK SERVICE - postVideo] Downloading video from:', videoUrl);
         const videoResponse = await axios.get(videoUrl, {
             responseType: 'arraybuffer',
             timeout: 60000, // Increased timeout for download
             maxContentLength: 600 * 1024 * 1024, // Allow large files
             maxBodyLength: 600 * 1024 * 1024
         });
         videoBuffer = Buffer.from(videoResponse.data);
          if (!videoBuffer || videoBuffer.length === 0) throw new Error("Downloaded video buffer is empty.");
         console.log(`[TIKTOK SERVICE - postVideo] Video downloaded, size: ${videoBuffer.length} bytes`);
     } catch (downloadError) {
         console.error('[TIKTOK SERVICE - postVideo] Video download failed:', downloadError.message);
         throw new Error(`Failed to download video: ${downloadError.message}`);
     }

    // Now init the upload
    const initRequest = {
      post_info: {
        title: caption || 'Video posted via API',
        description: caption || '',
        privacy_level: 'SELF_ONLY',
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000 // Try requesting cover at 1s
      },
      source_info: {
        source: "PULL_FROM_URL", // Use PULL_FROM_URL as intended
        video_url: videoUrl
      }
    };

    const headers = {
      'Authorization': `Bearer ${tokenToUse}`,
      'Content-Type': 'application/json; charset=UTF-8', // Specify charset
    };

     console.log(`[TIKTOK SERVICE - postVideo] Initializing video upload...`);
     console.log('[TIKTOK SERVICE - postVideo] Request Headers (excluding Authorization):', { ...headers, Authorization: 'Bearer [REDACTED]' });
     console.log('[TIKTOK SERVICE - postVideo] Request Body:', JSON.stringify(initRequest));


    const initResponse = await axios.post(TIKTOK_VIDEO_UPLOAD_URL, initRequest, {
      headers,
      timeout: 60000 // 60 second timeout for init
    });

     console.log('[TIKTOK SERVICE - postVideo] Init Response Status:', initResponse?.status);
     console.log('[TIKTOK SERVICE - postVideo] Init Response Data:', JSON.stringify(initResponse?.data, null, 2));

    if (!initResponse?.data?.data?.publish_id) {
      const errorData = initResponse?.data?.error;
      const errorMessage = errorData?.message || errorData?.code || 'Failed to initialize upload, no publish_id received.';
      console.error(`[TIKTOK SERVICE - postVideo] Upload initialization failed: ${errorMessage}`);
      throw new Error(`Upload initialization failed: ${errorMessage}`);
    }

     console.log(`[TIKTOK SERVICE - postVideo] Upload initialized successfully. Publish ID: ${initResponse.data.data.publish_id}`);
    // If initialization is successful, proceed to check status
    return await handleVideoUploadStatus(initResponse.data.data.publish_id, tokenToUse, currentRefreshToken);
  };

  try {
    // Initial attempt
    console.log('[TIKTOK SERVICE - postVideo] First attempt to post video.');
    const result = await attemptTikTokPost(currentAccessToken);
     // If tokens were refreshed during status check (less likely but possible)
     if (result.tokensRefreshed) {
        tokensRefreshed = true;
        newAccessToken = result.newAccessToken;
        newRefreshToken = result.newRefreshToken;
    }
    console.log('[TIKTOK SERVICE - postVideo] Initial post attempt successful.');
     return { ...result, tokensRefreshed, newAccessToken, newRefreshToken };

  } catch (error) {
    console.error('[TIKTOK SERVICE - postVideo] Initial post attempt failed:', error.message);

    // Check if it's a token error and refresh is possible
    const isTokenError = error.message?.includes('expired') || error.message?.includes('invalid') || error.response?.status === 401;
    console.log(`[TIKTOK SERVICE - postVideo] Is token error? ${isTokenError}. Can refresh? ${!!currentRefreshToken}. Attempted refresh? ${attemptedRefresh}`);


    if (isTokenError && currentRefreshToken && !attemptedRefresh) {
      console.log('[TIKTOK SERVICE - postVideo] Token error detected, attempting refresh...');
      attemptedRefresh = true;
      try {
        const refreshedTokens = await refreshTikTokToken(currentRefreshToken);
        console.log('[TIKTOK SERVICE - postVideo] Token refresh successful.');
        currentAccessToken = refreshedTokens.accessToken;
        currentRefreshToken = refreshedTokens.refreshToken; // Update refresh token as well
         tokensRefreshed = true; // Mark that tokens were refreshed
         newAccessToken = currentAccessToken;
         newRefreshToken = currentRefreshToken;


        console.log('[TIKTOK SERVICE - postVideo] Retrying post with refreshed token...');
        // Retry the post with new tokens
        const retryResult = await attemptTikTokPost(currentAccessToken);
        console.log('[TIKTOK SERVICE - postVideo] Post successful after token refresh.');
         // Ensure refresh status is correctly propagated from the retry result
         // (though handleVideoUploadStatus doesn't currently set this, add it for consistency if needed)
         tokensRefreshed = retryResult.tokensRefreshed || tokensRefreshed;
         newAccessToken = retryResult.newAccessToken || newAccessToken;
         newRefreshToken = retryResult.newRefreshToken || newRefreshToken;

         return { ...retryResult, tokensRefreshed, newAccessToken, newRefreshToken };

      } catch (refreshOrRetryError) {
        console.error('[TIKTOK SERVICE - postVideo] Error during token refresh or retry:', refreshOrRetryError.message);
        // If refresh failed with specific message, use that
        if (refreshOrRetryError.message.includes('reconnect your TikTok account')) {
             throw refreshOrRetryError;
        }
        // Otherwise, throw a generic error indicating refresh failure
        throw new Error(`Failed to post video after token refresh attempt: ${refreshOrRetryError.message}`);
      }
    } else {
      // If it wasn't a token error, or refresh wasn't possible/attempted, rethrow original error
       console.log('[TIKTOK SERVICE - postVideo] Not a token error or refresh not possible/failed. Rethrowing original error.');
      throw error;
    }
  }
}


// --- handleVideoUploadStatus, handleTikTokError, handleUploadFailure remain the same ---
// --- (Ensure handleVideoUploadStatus potentially returns refreshed token info if needed) ---
// Helper function to handle video upload status checks
async function handleVideoUploadStatus(publishId, accessToken, refreshToken) {
  let statusResponse = null;
  let attempts = 0;
  const maxAttempts = 15; // Increased attempts for potentially longer processing
  const initialDelay = 5000; // Start with a 5-second delay
  const maxDelay = 30000; // Cap delay at 30 seconds
  let currentDelay = initialDelay;
  let isComplete = false;
   let statusCheckResult = {}; // To store the final status check result data


  console.log(`[TIKTOK SERVICE - handleVideoUploadStatus] Starting status check loop for publish_id: ${publishId}`);

  while (!isComplete && attempts < maxAttempts) {
    attempts++;

    // Wait before checking status (implement backoff)
    console.log(`[TIKTOK SERVICE - handleVideoUploadStatus] Waiting ${currentDelay / 1000}s before status check #${attempts}`);
    await new Promise(resolve => setTimeout(resolve, currentDelay));

    try {
      console.log(`[TIKTOK SERVICE - handleVideoUploadStatus] Checking upload status, attempt ${attempts}/${maxAttempts}...`);

      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8', // Specify charset
      };

       // Note: X-Refresh-Token header is generally not used/needed for status checks
       // if (refreshToken) {
       //   headers['X-Refresh-Token'] = refreshToken;
       // }

      statusResponse = await axios.post('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
        publish_id: publishId
      }, {
        headers,
        timeout: 30000 // 30 second timeout for status check
      });

      console.log(`[TIKTOK SERVICE - handleVideoUploadStatus] Status check attempt ${attempts} response:`, JSON.stringify(statusResponse?.data, null, 2));

      statusCheckResult = statusResponse?.data || {}; // Store the latest response data
      const status = statusCheckResult?.data?.status;
      const failReason = statusCheckResult?.data?.fail_reason;

      if (status === 'PUBLISH_COMPLETE') {
        isComplete = true;
        console.log('[TIKTOK SERVICE - handleVideoUploadStatus] Video publish completed successfully.');
      } else if (status === 'FAILED' || status === 'PUBLISH_FAILED') {
        isComplete = true;
        console.error(`[TIKTOK SERVICE - handleVideoUploadStatus] Video publish failed. Reason: ${failReason || 'Unknown'}`);
        handleUploadFailure(failReason); // This will throw an error
      } else if (status === 'PROCESSING_UPLOAD') {
         console.log('[TIKTOK SERVICE - handleVideoUploadStatus] Video is still processing. Continuing checks...');
         // Increase delay for next check (exponential backoff)
         currentDelay = Math.min(currentDelay * 1.5, maxDelay);
      } else {
         // Handle other potential statuses or unexpected responses
         console.warn(`[TIKTOK SERVICE - handleVideoUploadStatus] Unexpected status: ${status || 'No Status'}. Continuing checks.`);
          currentDelay = Math.min(currentDelay * 1.5, maxDelay);
      }

    } catch (statusError) {
      console.error(`[TIKTOK SERVICE - handleVideoUploadStatus] Error during status check attempt ${attempts}:`, statusError?.response?.data || statusError?.message);

      // If the error is specifically about the publish ID not being found, fail fast
       if (statusError?.response?.data?.error?.code === 'publish_id_not_found') {
           console.error('[TIKTOK SERVICE - handleVideoUploadStatus] Publish ID not found on TikTok servers. Upload likely failed critically.');
           throw new Error('TikTok could not find the video upload session (publish_id_not_found). Upload failed.');
       }
       // Handle expired/invalid token during status check - though less likely
        const isTokenError = statusError?.response?.data?.error?.code === 'access_token_invalid' ||
                             statusError?.response?.data?.error?.code === 'access_token_has_expired' ||
                             statusError?.message?.toLowerCase().includes('token');
         if (isTokenError) {
             console.error("[TIKTOK SERVICE - handleVideoUploadStatus] Token became invalid during status check.");
             throw new Error("TikTok token became invalid during upload status check. Please reconnect.");
         }


      if (attempts >= maxAttempts) {
        console.error('[TIKTOK SERVICE - handleVideoUploadStatus] Max status check attempts reached.');
         // Return the last known status instead of throwing a generic error
          statusCheckResult.message = 'Max status check attempts reached. Upload status uncertain.';
          statusCheckResult.publishId = publishId;
          return statusCheckResult;
        // throw new Error(`Failed to get final upload status after ${maxAttempts} attempts: ${statusError?.message}`);
      }

      // Increase delay after an error too
      currentDelay = Math.min(currentDelay * 1.5, maxDelay);
    }
  } // End while loop

   // Prepare final result object based on the last successful status check
   const finalStatus = statusCheckResult?.data?.status;
   const finalFailReason = statusCheckResult?.data?.fail_reason;

   let finalMessage = 'Video upload status check complete.';
   if (finalStatus === 'PUBLISH_COMPLETE') {
       finalMessage = 'Video uploaded successfully. It may take some time to appear on your profile.';
   } else if (finalStatus === 'FAILED' || finalStatus === 'PUBLISH_FAILED') {
       finalMessage = `Video upload failed: ${finalFailReason || 'Unknown reason'}`;
   } else if (!isComplete && attempts >= maxAttempts) {
       finalMessage = 'Max status check attempts reached. Upload status uncertain. Please check your TikTok account.';
   } else {
       finalMessage = `Video upload finished with status: ${finalStatus || 'Unknown'}. Check your TikTok account.`;
   }

   return {
       ...(statusCheckResult), // Spread the last successful response data
       publishId,
       message: finalMessage
   };

}

// Helper function to handle upload failures more specifically
function handleUploadFailure(failReason) {
  console.error(`[TIKTOK SERVICE - handleUploadFailure] Handling failure reason: ${failReason}`);
  let userFriendlyMessage = `Upload failed: ${failReason || 'Unknown reason'}`;

  switch (failReason) {
    case 'video_too_long':
      userFriendlyMessage = 'Upload failed: The video duration exceeds TikTok\'s limit.';
      break;
    case 'video_too_short':
       userFriendlyMessage = 'Upload failed: The video duration is too short for TikTok.';
       break;
    case 'video_size_too_large':
      userFriendlyMessage = 'Upload failed: The video file size exceeds TikTok\'s limit.';
      break;
    case 'resolution_check_failed':
    case 'picture_size_check_failed': // Include this legacy code
      userFriendlyMessage = 'Upload failed: Video resolution or aspect ratio is not supported by TikTok. Recommended: 720p+ resolution, 9:16 aspect ratio.';
      break;
    case 'download_timeout':
    case 'download_failed':
      userFriendlyMessage = 'Upload failed: TikTok could not download the video from the provided URL. Please ensure the URL is public and accessible.';
      break;
    case 'publish_id_not_found':
        userFriendlyMessage = 'Upload failed: TikTok could not find the upload session. Please try again.';
        break;
    case 'internal_error':
         userFriendlyMessage = 'Upload failed due to a TikTok internal error. Please try again later.';
         break;
     // Add more specific error codes as needed based on TikTok documentation
  }
  throw new Error(userFriendlyMessage); // Throw the user-friendly message
}

// Modify handleTikTokError to be more specific about token errors
function handleTikTokError(error) {
  console.error('[TIKTOK SERVICE - handleTikTokError] Handling TikTok API Error');
  console.error('[TIKTOK SERVICE - handleTikTokError] Error Message:', error?.message);

  let errorCode = null;
  let errorMessage = error?.message || 'Unknown TikTok API error';

  if (error?.response?.data?.error) {
    errorCode = error.response.data.error.code;
    errorMessage = error.response.data.error.message || errorMessage;
    console.error('[TIKTOK SERVICE - handleTikTokError] API Error Code:', errorCode);
    console.error('[TIKTOK SERVICE - handleTikTokError] API Error Message:', errorMessage);
  } else if (error?.response?.status) {
     console.error('[TIKTOK SERVICE - handleTikTokError] HTTP Status:', error.response.status);
     // Try to parse non-JSON error response body if possible
     if (error.response.data && typeof error.response.data === 'string') {
        console.error('[TIKTOK SERVICE - handleTikTokError] Raw Error Response Body (partial):', error.response.data.substring(0, 200));
        // Attempt to extract common error patterns if not JSON
         if(error.response.data.toLowerCase().includes('invalid token')) errorCode = 'invalid_access_token';
         if(error.response.data.toLowerCase().includes('token expired')) errorCode = 'access_token_has_expired';
     }
  }

  // Standardize token-related error messages for upstream handling
  if (errorCode === 'access_token_has_expired' || errorCode === 'token_has_expired' || errorMessage.toLowerCase().includes('token expired')) {
    throw new Error('TikTok access token has expired.');
  }
  if (errorCode === 'invalid_access_token' || errorCode?.includes('invalid_token') || errorMessage.toLowerCase().includes('invalid token')) {
    throw new Error('TikTok access token is invalid.');
  }
  if (errorCode === 'invalid_refresh_token' || errorMessage.toLowerCase().includes('refresh token')) {
    throw new Error('TikTok refresh token is invalid.');
  }
   if (errorCode === 'scope_not_authorized' || error?.response?.status === 403) {
    throw new Error('App does not have required permissions (scope_not_authorized). Please reconnect your TikTok account ensuring all permissions are granted.');
   }
    if (errorCode === 'rate_limit_exceeded') {
      throw new Error('TikTok API rate limit exceeded. Please try again later.');
    }


  // Throw a generic but informative error for other cases
  throw new Error(`TikTok API error: ${errorMessage} (Code: ${errorCode || 'N/A'})`);
}


module.exports = { getAuthUrl, getAccessToken, refreshTikTokToken, postVideo, getUserInfo };