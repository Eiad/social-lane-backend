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
    const callbackUrl = `${process.env.BACKEND_URL}/twitter/callback`;
    
    console.log('Using Twitter callback URL:', callbackUrl);
    
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
      { 
        // Only use scopes explicitly supported by Twitter API v2
        scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
      }
    );
    
    console.log('Generated Twitter auth link successfully');
    console.log('Auth URL:', url);
    
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
    const appAccessToken = process.env.TWITTER_ACCESS_TOKEN;
    const appAccessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;
    
    if (!consumerKey || !consumerSecret) {
      console.error('Missing Twitter API credentials in environment variables');
      throw new Error('Server configuration error: Missing Twitter API credentials');
    }
    
    if (!appAccessToken || !appAccessTokenSecret) {
      console.error('Missing Twitter app access tokens in environment variables');
      throw new Error('Server configuration error: Missing Twitter app access tokens');
    }
    
    // Download the video
    console.log('Downloading video from URL:', videoUrl);
    let videoPath;
    
    try {
      // Implement retry logic for video download
      const MAX_RETRIES = 7;
      let retryCount = 0;
      
      while (retryCount < MAX_RETRIES) {
        try {
          console.log(`Attempt ${retryCount + 1} of ${MAX_RETRIES} to download video...`);
          
          const videoResponse = await axios({
            method: 'get',
            url: videoUrl,
            responseType: 'arraybuffer',
            timeout: 60000,
            maxContentLength: 600 * 1024 * 1024,
            maxBodyLength: 600 * 1024 * 1024,
            validateStatus: (status) => status >= 200 && status < 300,
            headers: {
              'Accept': 'video/*,*/*',
              'User-Agent': 'Mozilla/5.0 (compatible; SocialPostApp/1.0)'
            }
          });
          
          if (!videoResponse?.data) {
            throw new Error('Video download failed: Empty response');
          }
          
          videoPath = videoResponse.data;
          console.log('Downloaded video, size:', videoPath.length, 'bytes');
          
          if (!videoPath.length) {
            throw new Error('Video file is empty. Please check the URL and try again.');
          }
          
          break;
        } catch (error) {
          retryCount++;
          
          if (retryCount >= MAX_RETRIES) {
            throw new Error(`Failed to download video: ${error.response?.status ? `HTTP ${error.response.status}` : error.message}`);
          }
          
          console.log(`Download failed, retrying (${retryCount}/${MAX_RETRIES})...`);
          const delay = 2000 * Math.pow(2, retryCount - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (downloadError) {
      console.error('Error downloading video:', downloadError.message);
      throw new Error(`Failed to download video: ${downloadError.message}`);
    }
    
    // Create a temporary file
    const tempFilePath = path.join(__dirname, '..', 'temp', `twitter-video-${Date.now()}.mp4`);
    
    try {
      await fs.mkdir(path.join(__dirname, '..', 'temp'), { recursive: true });
      await fs.writeFile(tempFilePath, videoPath);
      console.log('Video saved to temporary file:', tempFilePath);
      
      const fileStats = await fs.stat(tempFilePath);
      console.log('File size:', fileStats.size, 'bytes');
      
      const MAX_VIDEO_SIZE = 512 * 1024 * 1024;
      if (fileStats.size > MAX_VIDEO_SIZE) {
        throw new Error(`Video file is too large for Twitter. Maximum size is 512MB.`);
      }
    } catch (fileError) {
      console.error('Error saving video to temporary file:', fileError.message);
      throw new Error(`Failed to save video to temporary file: ${fileError.message}`);
    }
    
    // Create Twitter client for media upload using app credentials (OAuth 1.0a)
    console.log('Creating Twitter client for media upload...');
    let uploadClient;
    
    try {
      uploadClient = new TwitterApi({
        appKey: consumerKey,
        appSecret: consumerSecret,
        accessToken: appAccessToken,
        accessSecret: appAccessTokenSecret,
        timeout: 120000
      });
      
      console.log('Created Twitter client with app credentials for media upload');
    } catch (clientError) {
      console.error('Error creating Twitter upload client:', clientError.message);
      throw new Error(`Failed to create Twitter upload client: ${clientError.message}`);
    }
    
    // Upload the video to Twitter
    console.log('Uploading video to Twitter...');
    let mediaId;
    
    try {
      const MAX_RETRIES = 7;
      let retryCount = 0;
      
      while (retryCount < MAX_RETRIES) {
        try {
          console.log(`Attempt ${retryCount + 1} of ${MAX_RETRIES} to upload media...`);
          
          // Initialize media upload
          mediaId = await uploadClient.v1.uploadMedia(tempFilePath, {
            mimeType: 'video/mp4',
            type: 'tweet_video',
            chunkLength: 1000000,
            longVideo: true
          });
          
          console.log('Media uploaded successfully. Media ID:', mediaId);
          break;
        } catch (error) {
          retryCount++;
          
          if (retryCount >= MAX_RETRIES) {
            throw error;
          }
          
          console.log(`Upload failed, retrying (${retryCount}/${MAX_RETRIES})...`);
          const delay = 2000 * Math.pow(2, retryCount - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (uploadError) {
      console.error('Error uploading media to Twitter:', uploadError.message);
      
      try {
        await fs.unlink(tempFilePath);
        console.log('Temporary file deleted');
      } catch (cleanupError) {
        console.error('Error deleting temporary file:', cleanupError.message);
      }
      
      if (uploadError.message?.includes('Bad Authentication data') || 
          (uploadError.data?.errors && uploadError.data.errors.some(e => e.code === 215))) {
        throw new Error('Twitter authentication failed. Please check your app credentials.');
      }
      
      throw new Error(`Failed to upload media to Twitter: ${uploadError.message}`);
    }
    
    // Post the tweet with the uploaded media
    console.log('Posting tweet with video...');
    let tweetResponse;
    
    try {
      const MAX_RETRIES = 7;
      let retryCount = 0;
      
      while (retryCount < MAX_RETRIES) {
        try {
          console.log(`Attempt ${retryCount + 1} of ${MAX_RETRIES} to post tweet...`);
          
          tweetResponse = await uploadClient.v2.tweet({
            text: text || '',
            media: {
              media_ids: [mediaId]
            }
          });
          
          console.log('Tweet posted successfully:', tweetResponse);
          break;
        } catch (error) {
          retryCount++;
          
          if (retryCount >= MAX_RETRIES) {
            throw error;
          }
          
          console.log(`Tweet failed, retrying (${retryCount}/${MAX_RETRIES})...`);
          const delay = 2000 * Math.pow(2, retryCount - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (tweetError) {
      console.error('Error posting tweet:', tweetError.message);
      throw new Error(`Failed to post tweet: ${tweetError.message}`);
    } finally {
      try {
        await fs.unlink(tempFilePath);
        console.log('Temporary file deleted');
      } catch (cleanupError) {
        console.error('Error deleting temporary file:', cleanupError.message);
      }
    }
    
    console.log('=== TWITTER POSTING PROCESS END ===');
    return tweetResponse;
  } catch (error) {
    console.error('=== TWITTER POSTING PROCESS ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// Get user information
async function getUserInfo(accessToken) {
  try {
    console.log('Getting user info with access token');
    
    // Create a Twitter client with the provided access token
    const twitterClient = new TwitterApi(accessToken);
    
    // Get the user information with expanded fields
    const userInfo = await twitterClient.v2.me({
      'user.fields': ['id', 'name', 'username', 'profile_image_url', 'description', 'public_metrics', 'verified', 'location', 'url'],
    });
    
    console.log('User info retrieved successfully:', {
      has_data: !!userInfo?.data,
      has_profile_image: !!userInfo?.data?.profile_image_url,
      username: userInfo?.data?.username,
      name: userInfo?.data?.name
    });
    
    return userInfo?.data;
  } catch (error) {
    console.error('Error getting user info:', error?.message);
    if (error?.code === 401 || error?.message?.includes('unauthorized') || error?.message?.includes('Unauthorized')) {
      console.error('Authentication error when getting user info, token may have expired');
      throw new Error('Authentication failed, please reconnect your Twitter account');
    }
    throw new Error(`Failed to get user info: ${error?.message || 'Unknown error'}`);
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