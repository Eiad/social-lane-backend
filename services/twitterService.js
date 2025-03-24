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

// Create Twitter OAuth 1.0a client for user authentication
async function getAuthUrl() {
  try {
    console.log('Generating Twitter OAuth 1.0a authentication URL');
    
    // Callback URL for OAuth process
    const callbackUrl = `${process.env.BACKEND_URL}/twitter/callback`;
    console.log('Using Twitter callback URL:', callbackUrl);
    
    // Check if we have the required credentials
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET) {
      console.error('Missing Twitter API credentials');
      throw new Error('Missing Twitter API credentials');
    }
    
    // Create a client with app-only client for OAuth 1.0a
    const client = new TwitterApi({
      appKey: TWITTER_API_KEY,
      appSecret: TWITTER_API_SECRET,
    });
    
    console.log('Creating Twitter OAuth 1.0a client');
    
    // Generate auth link
    const authLink = await client.generateAuthLink(callbackUrl, { 
      linkMode: 'authorize',
      forceLogin: true 
    });
    
    console.log('Auth link generated successfully:', authLink.url);
    
    return authLink;
  } catch (error) {
    console.error('Error generating Twitter auth URL:', error?.message);
    console.error('Error stack:', error?.stack);
    throw new Error(`Failed to generate Twitter auth URL: ${error?.message || 'Unknown error'}`);
  }
}

// Exchange verifier for access tokens
async function getAccessToken(oauthToken, oauthVerifier, tokenSecret) {
  try {
    console.log('Exchanging OAuth verifier for access token');
    console.log('OAuth parameters:', { 
      oauthToken: oauthToken ? `${oauthToken.substring(0, 5)}...` : 'missing',
      oauthVerifier: oauthVerifier ? `${oauthVerifier.substring(0, 5)}...` : 'missing' 
    });
    
    // Check if we have the required credentials
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET) {
      console.error('Missing Twitter API credentials');
      throw new Error('Missing Twitter API credentials');
    }
    
    // Check if we have the required oauth parameters
    if (!oauthToken || !oauthVerifier) {
      console.error('Missing OAuth token or verifier');
      throw new Error('Missing OAuth token or verifier');
    }
    
    console.log('Creating temporary client with request token');
    
    try {
      // Create temporary client with the request token
      // Important: We need to use v1 specifically for Twitter OAuth 1.0a flow
      console.log('Initializing Twitter client with v1 API for OAuth 1.0a flow');
      const client = new TwitterApi({
        appKey: TWITTER_API_KEY,
        appSecret: TWITTER_API_SECRET,
        accessToken: oauthToken,
        accessSecret: tokenSecret,
      });
      
      console.log('Calling login with verifier:', oauthVerifier.substring(0, 5) + '...');
      
      // Debug OAuth 1.0a request details
      client.debug = true;
      
      // Use try/catch specifically around the login call
      try {
        // Get access tokens - explicitly specifying to use v1 auth
        const { client: loggedClient, accessToken, accessSecret } = await client.login(oauthVerifier);
        
        console.log('Access tokens obtained successfully:', {
          accessTokenPrefix: accessToken ? accessToken.substring(0, 5) + '...' : 'missing',
          accessSecretPrefix: accessSecret ? accessSecret.substring(0, 5) + '...' : 'missing'
        });
        
        // Get user information with the logged client (using v2 endpoint)
        console.log('Getting user info with the logged client');
        const currentUser = await loggedClient.v2.me();
        
        console.log('User info retrieved:', {
          userId: currentUser?.data?.id,
          username: currentUser?.data?.username
        });
        
        return {
          access_token: accessToken,
          access_token_secret: accessSecret,
          user_id: currentUser?.data?.id,
          username: currentUser?.data?.username,
        };
      } catch (loginError) {
        console.error('Twitter login error details:', loginError);
        console.error('Login error message:', loginError.message);
        
        if (loginError.data) {
          console.error('Twitter API error data:', JSON.stringify(loginError.data, null, 2));
        }
        
        // Check specifically for 401 error
        if (loginError.code === 401 || loginError.message?.includes('401')) {
          console.error('OAuth token validation failed (401 Unauthorized)');
          console.error('This could be due to:');
          console.error('1. Invalid consumer key/secret');
          console.error('2. The OAuth token has expired');
          console.error('3. The OAuth verifier is invalid');
          console.error('4. The OAuth token was already used');
          
          // Try alternate approach for token exchange
          console.log('Attempting manual OAuth token exchange as fallback...');
          
          try {
            // Create a new client without the access token
            const fallbackClient = new TwitterApi({
              appKey: TWITTER_API_KEY,
              appSecret: TWITTER_API_SECRET,
            });
            
            // Manual OAuth token exchange request
            const tokenExchangeUrl = 'https://api.twitter.com/oauth/access_token';
            const params = new URLSearchParams();
            params.append('oauth_token', oauthToken);
            params.append('oauth_verifier', oauthVerifier);
            
            const tokenResponse = await fallbackClient.v1.get(tokenExchangeUrl, { params });
            console.log('Manual token exchange response:', tokenResponse);
            
            // Parse the response
            const responseParams = new URLSearchParams(tokenResponse);
            const manualAccessToken = responseParams.get('oauth_token');
            const manualAccessSecret = responseParams.get('oauth_token_secret');
            const userId = responseParams.get('user_id');
            const screenName = responseParams.get('screen_name');
            
            if (manualAccessToken && manualAccessSecret) {
              console.log('Manual token exchange successful');
              
              return {
                access_token: manualAccessToken,
                access_token_secret: manualAccessSecret,
                user_id: userId,
                username: screenName,
              };
            } else {
              throw new Error('Failed to parse manual token exchange response');
            }
          } catch (fallbackError) {
            console.error('Fallback token exchange failed:', fallbackError.message);
            throw new Error('Twitter authentication failed. Please try again.');
          }
        }
        
        // Log API key check without exposing full key
        if (TWITTER_API_KEY) {
          console.log('API Key check (first/last 3 chars):', 
            TWITTER_API_KEY.substring(0, 3) + '...' + 
            TWITTER_API_KEY.substring(TWITTER_API_KEY.length - 3));
        }
        
        throw new Error('Twitter authentication failed. Please try again.');
      }
    } catch (clientError) {
      console.error('Error during Twitter authentication:', clientError.message);
      console.error('Stack trace:', clientError.stack);
      throw new Error(`Twitter authentication failed: ${clientError.message}`);
    }
  } catch (error) {
    console.error('Error getting access token:', error?.message);
    console.error('Error stack:', error?.stack);
    throw new Error('Failed to get access token: ' + (error?.message || 'Unknown error'));
  }
}

// Post media tweet to Twitter
async function postMediaTweet(videoUrl, accessToken, text = '', accessTokenSecret = '') {
  try {
    console.log('=== TWITTER POSTING PROCESS START ===');
    
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
    
    if (!accessToken) {
      console.error('Missing user Twitter OAuth token');
      throw new Error('Missing user Twitter access token');
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
    
    // Create Twitter client with user credentials for OAuth 1.0a
    console.log('Creating Twitter client with user OAuth 1.0a credentials...');
    let userClient;
    
    try {
      userClient = new TwitterApi({
        appKey: consumerKey,
        appSecret: consumerSecret,
        accessToken: accessToken,
        accessSecret: accessTokenSecret,
        timeout: 120000
      });
      
      console.log('Created Twitter client with user OAuth 1.0a credentials');
      
      // Verify user credentials
      try {
        const verifyResult = await userClient.v1.verifyCredentials();
        console.log('User credentials verified successfully. Username:', verifyResult.screen_name);
      } catch (verifyError) {
        console.error('Error verifying user credentials:', verifyError.message);
        throw new Error('Failed to verify user credentials. Please reconnect your Twitter account.');
      }
    } catch (clientError) {
      console.error('Error creating Twitter client with user credentials:', clientError.message);
      throw new Error(`Failed to create Twitter client: ${clientError.message}`);
    }
    
    // Upload the video to Twitter using user credentials
    console.log('Uploading video to Twitter using user credentials...');
    let mediaId;
    
    try {
      const MAX_RETRIES = 7;
      let retryCount = 0;
      
      while (retryCount < MAX_RETRIES) {
        try {
          console.log(`Attempt ${retryCount + 1} of ${MAX_RETRIES} to upload media...`);
          
          // Initialize media upload with user credentials
          mediaId = await userClient.v1.uploadMedia(tempFilePath, {
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
        throw new Error('Twitter authentication failed. Please check user credentials.');
      }
      
      throw new Error(`Failed to upload media to Twitter: ${uploadError.message}`);
    }
    
    // Post the tweet with the uploaded media using user client
    console.log('Posting tweet with video using user client...');
    let tweetResponse;
    
    try {
      const MAX_RETRIES = 7;
      let retryCount = 0;
      
      while (retryCount < MAX_RETRIES) {
        try {
          console.log(`Attempt ${retryCount + 1} of ${MAX_RETRIES} to post tweet...`);
          
          // Post tweet with user's credentials
          tweetResponse = await userClient.v2.tweet({
            text: text || '',
            media: {
              media_ids: [mediaId]
            }
          });
          
          console.log('Tweet posted successfully:', tweetResponse);
          break;
        } catch (error) {
          retryCount++;
          
          // Log detailed error information
          console.error(`Tweet attempt ${retryCount} failed:`, error.message);
          if (error.data) {
            console.error('Error data:', JSON.stringify(error.data, null, 2));
          }
          
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
      if (tweetError.data) {
        console.error('Twitter API error data:', JSON.stringify(tweetError.data, null, 2));
      }
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
async function getUserInfo(accessToken, accessTokenSecret) {
  try {
    console.log('Getting Twitter user info with tokens:', {
      accessTokenPrefix: accessToken ? accessToken.substring(0, 5) + '...' : 'missing',
      accessTokenSecretPrefix: accessTokenSecret ? accessTokenSecret.substring(0, 5) + '...' : 'missing'
    });
    
    // Create a Twitter client with user tokens
    const client = new TwitterApi({
      appKey: TWITTER_API_KEY,
      appSecret: TWITTER_API_SECRET,
      accessToken: accessToken,
      accessSecret: accessTokenSecret,
    });
    
    // Use the v2 API to get user data
    const userV2 = await client.v2.me({
      'user.fields': ['profile_image_url', 'name', 'username', 'description']
    });
    
    if (!userV2 || !userV2.data) {
      throw new Error('Failed to retrieve user information from Twitter API');
    }
    
    console.log('Twitter user info retrieved:', {
      id: userV2.data.id,
      username: userV2.data.username,
      name: userV2.data.name,
      hasProfileImage: !!userV2.data.profile_image_url
    });
    
    return {
      id_str: userV2.data.id,
      screen_name: userV2.data.username,
      name: userV2.data.name,
      profile_image_url: userV2.data.profile_image_url,
      description: userV2.data.description
    };
  } catch (error) {
    console.error('Error getting Twitter user info:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Return a basic object with empty values rather than throwing
    // This prevents the whole auth flow from failing just because profile data couldn't be fetched
    return {
      id_str: '',
      screen_name: '',
      name: '',
      profile_image_url: '',
      description: ''
    };
  }
}

module.exports = {
  getAuthUrl,
  getAccessToken,
  postMediaTweet,
  getUserInfo
}; 