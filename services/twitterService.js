const { TwitterApi } = require('twitter-api-v2');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Twitter API credentials from environment variables
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET;
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;

// Generate Twitter OAuth URL
function getAuthUrl() {
  try {
    // Twitter OAuth 2.0 with PKCE flow is recommended for user authentication
    // This is a simplified version for demonstration
    const callbackUrl = `${process.env.BACKEND_URL}/twitter/callback`;
    
    // Check if we have the required credentials
    const clientId = TWITTER_CLIENT_ID;
    const clientSecret = TWITTER_CLIENT_SECRET;
    
    if (!clientId) {
      console.error('Missing Twitter API client ID');
      throw new Error('Missing Twitter API client ID');
    }
    
    if (!clientSecret) {
      console.error('Missing Twitter API client secret');
      throw new Error('Missing Twitter API client secret');
    }
    
    console.log('Using client ID for OAuth 2.0:', clientId ? clientId.substring(0, 5) + '...' : 'Missing');
    
    // Create a client with consumer keys only
    const client = new TwitterApi({
      clientId: clientId,
      clientSecret: clientSecret,
    });
    
    console.log('Creating Twitter client with credentials:', { 
      clientId: clientId ? '✓ Present' : '✗ Missing',
      clientSecret: clientSecret ? '✓ Present' : '✗ Missing'
    });
    
    // Generate auth link
    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
      callbackUrl, 
      { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] }
    );
    
    console.log('Generated Twitter auth link successfully');
    
    // Store codeVerifier and state for later use in the callback
    // In a real app, you would store these in a database or session
    return { url, codeVerifier, state };
  } catch (error) {
    console.error('Error generating Twitter auth URL:', error?.message);
    console.error('Error stack:', error?.stack);
    throw new Error(`Failed to generate Twitter auth URL: ${error?.message || 'Unknown error'}`);
  }
}

// Exchange code for access token
async function getAccessToken(code, codeVerifier, redirectUri) {
  try {
    console.log('Exchanging code for access token with code:', code);
    
    // Check if we have the required credentials
    const clientId = TWITTER_CLIENT_ID;
    const clientSecret = TWITTER_CLIENT_SECRET;
    
    if (!clientId) {
      console.error('Missing Twitter API client ID');
      throw new Error('Missing Twitter API client ID');
    }
    
    if (!clientSecret) {
      console.error('Missing Twitter API client secret');
      throw new Error('Missing Twitter API client secret');
    }
    
    console.log('Using client ID for OAuth 2.0 token exchange:', clientId ? clientId.substring(0, 5) + '...' : 'Missing');
    
    // Create a client with consumer keys only
    const client = new TwitterApi({
      clientId: clientId,
      clientSecret: clientSecret,
    });
    
    console.log('Creating Twitter client with credentials for token exchange');
    
    // Get tokens
    const { accessToken, refreshToken } = await client.loginWithOAuth2({
      code,
      codeVerifier,
      redirectUri: redirectUri || `${process.env.BACKEND_URL}/twitter/callback`,
    });
    
    console.log('Token response received:', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      accessTokenPrefix: accessToken ? accessToken.substring(0, 5) + '...' : 'missing',
      refreshTokenPrefix: refreshToken ? refreshToken.substring(0, 5) + '...' : 'missing'
    });
    
    // Create a client with the received tokens
    const loggedClient = new TwitterApi(accessToken);
    
    // Get the user ID
    const currentUser = await loggedClient.v2.me();
    
    console.log('User info retrieved:', {
      userId: currentUser?.data?.id,
      username: currentUser?.data?.username
    });
    
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user_id: currentUser?.data?.id,
      username: currentUser?.data?.username,
    };
  } catch (error) {
    console.error('Error getting access token:', error?.response?.data || error?.message);
    console.error('Error stack:', error?.stack);
    throw new Error('Failed to get access token: ' + (error?.message || 'Unknown error'));
  }
}

// Post media tweet to Twitter
async function postMediaTweet(videoUrl, accessToken, text = '', accessTokenSecret = '') {
  try {
    console.log('=== TWITTER POSTING PROCESS START ===');
    console.log('Posting media tweet with credentials:', {
      hasAccessToken: !!accessToken,
      hasAccessTokenSecret: !!accessTokenSecret,
      accessTokenPrefix: accessToken ? accessToken.substring(0, 5) + '...' : 'missing',
      accessTokenSecretPrefix: accessTokenSecret ? accessTokenSecret.substring(0, 5) + '...' : 'missing'
    });
    
    // Check if we have the required credentials
    const consumerKey = process.env.TWITTER_API_KEY;
    const consumerSecret = process.env.TWITTER_API_SECRET;
    
    if (!consumerKey || !consumerSecret) {
      console.error('Missing Twitter API credentials in environment variables');
      throw new Error('Server configuration error: Missing Twitter API credentials');
    }
    
    console.log('Twitter API credentials check:', {
      hasConsumerKey: !!consumerKey,
      hasConsumerSecret: !!consumerSecret,
      consumerKeyPrefix: consumerKey ? consumerKey.substring(0, 5) + '...' : 'missing'
    });
    
    // First, download the video
    console.log('Attempting to download video from URL:', videoUrl);
    let videoBuffer;
    
    try {
      console.log('Making HTTP request to download video...');
      
      // Implement retry logic for video download
      const MAX_RETRIES = 3;
      let retryCount = 0;
      let lastError = null;
      
      while (retryCount < MAX_RETRIES) {
        try {
          console.log(`Attempt ${retryCount + 1} of ${MAX_RETRIES} to download video...`);
          
          // Add timeout to prevent hanging on inaccessible URLs
          const videoResponse = await axios.get(videoUrl, { 
            responseType: 'arraybuffer',
            timeout: 60000, // 60 second timeout (increased from 30s)
            validateStatus: status => status >= 200 && status < 300, // Only accept 2xx status codes
            maxContentLength: 600 * 1024 * 1024, // 600MB max (to handle large videos)
            maxBodyLength: 600 * 1024 * 1024 // 600MB max
          });
          
          console.log('Video download response status:', videoResponse?.status);
          
          if (!videoResponse?.data) {
            console.error('Video download response has no data');
            throw new Error('Video download failed: Empty response');
          }
          
          videoBuffer = Buffer.from(videoResponse?.data);
          
          console.log('Downloaded video, size:', videoBuffer?.length, 'bytes');
          
          // Check if video size is valid
          if (!videoBuffer?.length) {
            console.error('Video buffer is empty or undefined');
            throw new Error('Video file is empty. Please check the URL and try again.');
          }
          
          break; // Success, exit the retry loop
        } catch (error) {
          lastError = error;
          retryCount++;
          
          if (retryCount >= MAX_RETRIES) {
            console.error(`Failed after ${MAX_RETRIES} attempts to download video.`);
            throw error; // Re-throw the last error after max retries
          }
          
          console.log(`Download failed, retrying (${retryCount}/${MAX_RETRIES})...`);
          // Wait before retrying (exponential backoff)
          const delay = 2000 * Math.pow(2, retryCount - 1); // 2s, 4s, 8s
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (downloadError) {
      console.error('=== VIDEO DOWNLOAD ERROR ===');
      console.error('Error downloading video:', downloadError?.message);
      
      if (downloadError?.response) {
        console.error('Error response status:', downloadError.response.status);
      }
      
      throw new Error(`Failed to download video: ${downloadError?.message}`);
    }
    
    // Create a temporary file path for the video
    const tempFilePath = path.join(__dirname, '..', 'temp', `twitter-video-${Date.now()}.mp4`);
    
    try {
      // Ensure the temp directory exists
      await fs.mkdir(path.join(__dirname, '..', 'temp'), { recursive: true });
      
      // Write the video buffer to a temporary file
      await fs.writeFile(tempFilePath, videoBuffer);
      console.log('Video saved to temporary file:', tempFilePath);
      
      // Check file size - Twitter has limits on media uploads
      const fileStats = await fs.stat(tempFilePath);
      console.log('File size:', fileStats.size, 'bytes');
      
      // Twitter limits video uploads to 512MB for most accounts
      const MAX_VIDEO_SIZE = 512 * 1024 * 1024; // 512MB
      if (fileStats.size > MAX_VIDEO_SIZE) {
        console.error(`File size (${fileStats.size} bytes) exceeds Twitter's limit of ${MAX_VIDEO_SIZE} bytes`);
        throw new Error(`Video file is too large for Twitter. Maximum size is 512MB.`);
      }
    } catch (fileError) {
      console.error('Error saving video to temporary file:', fileError?.message);
      throw new Error(`Failed to save video to temporary file: ${fileError?.message}`);
    }
    
    // Create a Twitter client with the provided access token
    console.log('Creating Twitter client for media upload...');
    let twitterClient;
    
    try {
      // For media uploads with Twitter API v2, we need to use app-only authentication
      // This is because user tokens from OAuth 2.0 don't have the necessary permissions for media uploads
      
      // Get the app credentials
      const consumerKey = process.env.TWITTER_API_KEY;
      const consumerSecret = process.env.TWITTER_API_SECRET;
      
      if (!consumerKey || !consumerSecret) {
        console.error('Missing consumer key/secret for Twitter API');
        throw new Error('Missing Twitter API credentials');
      }
      
      console.log('Using app credentials for media upload:', {
        hasConsumerKey: !!consumerKey,
        hasConsumerSecret: !!consumerSecret,
        consumerKeyPrefix: consumerKey ? consumerKey.substring(0, 5) + '...' : 'missing'
      });
      
      // For media uploads, we need to use the app's own tokens
      // These should be set in the environment variables
      const appAccessToken = process.env.TWITTER_ACCESS_TOKEN;
      const appAccessSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;
      
      if (appAccessToken && appAccessSecret) {
        // Use the app's own tokens for media upload
        console.log('Using app tokens for media upload');
        twitterClient = new TwitterApi({
          appKey: consumerKey,
          appSecret: consumerSecret,
          accessToken: appAccessToken,
          accessSecret: appAccessSecret
        });
      } else if (accessToken && accessTokenSecret) {
        // If we have user tokens, try to use them
        console.log('Using provided user tokens for media upload');
        twitterClient = new TwitterApi({
          appKey: consumerKey,
          appSecret: consumerSecret,
          accessToken: accessToken,
          accessSecret: accessTokenSecret
        });
      } else {
        // Fallback to app-only client
        console.log('Falling back to app-only client');
        twitterClient = new TwitterApi({
          appKey: consumerKey,
          appSecret: consumerSecret
        });
      }
    } catch (clientError) {
      console.error('Error creating Twitter client:', clientError?.message);
      throw new Error(`Failed to create Twitter client: ${clientError?.message}`);
    }
    
    // Upload the media to Twitter
    console.log('Uploading media to Twitter...');
    let mediaId;
    
    try {
      // For larger videos, we need to use chunked upload
      // Twitter's media upload can be slow and timeout for larger files
      console.log('Using chunked upload for video file');
      
      // Set timeout options for the Twitter API client
      // Note: twitter-api-v2 doesn't have setRequestTimeout method
      // Instead, we need to create a new client with timeout options
      let clientWithTimeout;
      
      // Check if we're using OAuth 1.0a or OAuth 2.0
      if (twitterClient._requestMaker && twitterClient._requestMaker.consumerToken) {
        // OAuth 1.0a client
        clientWithTimeout = new TwitterApi({
          appKey: twitterClient._requestMaker.consumerToken,
          appSecret: twitterClient._requestMaker.consumerSecret,
          accessToken: twitterClient._requestMaker.accessToken,
          accessSecret: twitterClient._requestMaker.accessSecret,
          timeout: 120000 // 2 minutes timeout
        });
      } else {
        // OAuth 2.0 client
        clientWithTimeout = new TwitterApi(accessToken, {
          timeout: 120000 // 2 minutes timeout
        });
      }
      
      console.log('Created Twitter client with timeout settings for media upload');
      
      // Implement retry logic for media upload
      const MAX_RETRIES = 3;
      let retryCount = 0;
      let lastError = null;
      
      while (retryCount < MAX_RETRIES) {
        try {
          console.log(`Attempt ${retryCount + 1} of ${MAX_RETRIES} to upload media...`);
          
          // Upload the media to Twitter with chunked upload
          mediaId = await clientWithTimeout.v1.uploadMedia(tempFilePath, {
            mimeType: 'video/mp4',
            type: 'tweet_video',
            chunkLength: 1000000, // 1MB chunks
            longVideo: true, // Enable long video processing
            // Remove additionalOwners when it's empty as it causes API errors
            // additionalOwners: [], // No additional owners
          });
          
          console.log('Media uploaded successfully. Media ID:', mediaId);
          break; // Success, exit the retry loop
        } catch (error) {
          lastError = error;
          retryCount++;
          
          if (retryCount >= MAX_RETRIES) {
            console.error(`Failed after ${MAX_RETRIES} attempts to upload media.`);
            throw error; // Re-throw the last error after max retries
          }
          
          console.log(`Upload failed, retrying (${retryCount}/${MAX_RETRIES})...`);
          // Wait before retrying (exponential backoff)
          const delay = 2000 * Math.pow(2, retryCount - 1); // 2s, 4s, 8s
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (uploadError) {
      console.error('Error uploading media to Twitter:', uploadError?.message);
      console.error('Error details:', uploadError?.data || 'No additional error data');
      
      if (uploadError?.code) {
        console.error('Twitter API error code:', uploadError.code);
      }
      
      if (uploadError?.data?.errors) {
        console.error('Twitter API errors:', JSON.stringify(uploadError.data.errors));
      }
      
      // Clean up the temporary file
      try {
        await fs.unlink(tempFilePath);
        console.log('Temporary file deleted');
      } catch (cleanupError) {
        console.error('Error deleting temporary file:', cleanupError?.message);
      }
      
      // If this is an authentication error, provide a more helpful message
      if (uploadError?.message?.includes('Bad Authentication data') || 
          (uploadError?.data?.errors && uploadError.data.errors.some(e => e.code === 215))) {
        console.error('=== TWITTER AUTHENTICATION ERROR ===');
        console.error('This is likely due to invalid or expired tokens, or incorrect app credentials.');
        console.error('Please check your Twitter API credentials and ensure the user has re-authenticated.');
        
        throw new Error('Twitter authentication failed. Please reconnect your Twitter account and try again.');
      }
      
      throw new Error(`Failed to upload media to Twitter: ${uploadError?.message}`);
    }
    
    // Post the tweet with the media
    console.log('Posting tweet with media...');
    let tweet;
    
    try {
      // For posting tweets, we need to use the OAuth 2.0 client
      const oauth2Client = new TwitterApi(accessToken);
      
      // Set timeout options for the Twitter API client
      // Note: twitter-api-v2 doesn't have setRequestTimeout method
      // Instead, we need to create a new client with timeout options
      const oauth2ClientWithTimeout = new TwitterApi(accessToken, {
        timeout: 60000 // 1 minute timeout
      });
      
      console.log('Created Twitter client with timeout settings for tweet posting');
      
      console.log('Posting tweet with media ID:', mediaId);
      
      // Implement retry logic for tweet posting
      const MAX_RETRIES = 3;
      let retryCount = 0;
      let lastError = null;
      
      while (retryCount < MAX_RETRIES) {
        try {
          console.log(`Attempt ${retryCount + 1} of ${MAX_RETRIES} to post tweet...`);
          
          // Post the tweet with the media
          tweet = await oauth2ClientWithTimeout.v2.tweet({
            text: text || 'Check out this video!',
            media: { media_ids: [mediaId] },
          });
          
          console.log('Tweet posted successfully:', tweet);
          break; // Success, exit the retry loop
        } catch (error) {
          lastError = error;
          retryCount++;
          
          if (retryCount >= MAX_RETRIES) {
            console.error(`Failed after ${MAX_RETRIES} attempts to post tweet.`);
            throw error; // Re-throw the last error after max retries
          }
          
          console.log(`Tweet posting failed, retrying (${retryCount}/${MAX_RETRIES})...`);
          // Wait before retrying (exponential backoff)
          const delay = 2000 * Math.pow(2, retryCount - 1); // 2s, 4s, 8s
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (tweetError) {
      console.error('Error posting tweet:', tweetError?.message);
      throw new Error(`Failed to post tweet: ${tweetError?.message}`);
    }
    
    // Clean up the temporary file
    try {
      await fs.unlink(tempFilePath);
      console.log('Temporary file deleted');
    } catch (cleanupError) {
      console.error('Error deleting temporary file:', cleanupError?.message);
    }
    
    console.log('=== TWITTER POSTING PROCESS COMPLETE ===');
    
    return {
      success: true,
      tweetId: tweet?.data?.id,
      message: 'Tweet posted successfully',
      data: tweet?.data
    };
  } catch (error) {
    console.error('=== TWITTER POST MEDIA TWEET ERROR ===');
    console.error('Error posting media tweet:', error?.message);
    console.error('Error stack:', error?.stack);
    throw new Error(`Failed to post media tweet: ${error?.message}`);
  }
}

// Get user information
async function getUserInfo(accessToken) {
  try {
    console.log('Getting user info with access token');
    
    // Create a Twitter client with the provided access token
    const twitterClient = new TwitterApi(accessToken);
    
    // Get the user information
    const userInfo = await twitterClient.v2.me({
      'user.fields': ['id', 'name', 'username', 'profile_image_url', 'description', 'public_metrics'],
    });
    
    console.log('User info retrieved successfully');
    
    return userInfo?.data;
  } catch (error) {
    console.error('Error getting user info:', error?.message);
    throw new Error(`Failed to get user info: ${error?.message}`);
  }
}

// Refresh an expired access token
async function refreshAccessToken(refreshToken) {
  try {
    console.log('Refreshing access token');
    
    // Check if we have the required credentials
    const clientId = TWITTER_CLIENT_ID;
    const clientSecret = TWITTER_CLIENT_SECRET;
    
    if (!clientId) {
      console.error('Missing Twitter API client ID');
      throw new Error('Missing Twitter API client ID');
    }
    
    if (!clientSecret) {
      console.error('Missing Twitter API client secret');
      throw new Error('Missing Twitter API client secret');
    }
    
    console.log('Using client ID for OAuth 2.0 token refresh:', clientId ? clientId.substring(0, 5) + '...' : 'Missing');
    
    // Create a client with consumer keys only
    const client = new TwitterApi({
      clientId: clientId,
      clientSecret: clientSecret,
    });
    
    console.log('Creating Twitter client with credentials for token refresh');
    
    // Refresh the token
    const { accessToken, refreshToken: newRefreshToken } = await client.refreshOAuth2Token(refreshToken);
    
    console.log('Access token refreshed successfully');
    
    return {
      access_token: accessToken,
      refresh_token: newRefreshToken,
    };
  } catch (error) {
    console.error('Error refreshing access token:', error?.message);
    console.error('Error stack:', error?.stack);
    throw new Error(`Failed to refresh access token: ${error?.message || 'Unknown error'}`);
  }
}

module.exports = {
  getAuthUrl,
  getAccessToken,
  postMediaTweet,
  getUserInfo,
  refreshAccessToken,
}; 