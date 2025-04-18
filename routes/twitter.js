const express = require('express');
const router = express.Router();
const twitterService = require('../services/twitterService');
const userService = require('../services/userService');
const { TwitterApi } = require('twitter-api-v2');

// Store request tokens temporarily (in a real app, use a database or session)
const requestTokens = new Map();

// Get Twitter auth URL
router.get('/auth', async (req, res) => {
  try {
    const authResult = await twitterService.getAuthUrl();
    
    if (!authResult?.oauth_token) {
      console.error('Invalid auth data returned:', authResult);
      return res.status(500).json({ error: 'Failed to generate auth URL: Invalid auth data' });
    }
    
    const { oauth_token, oauth_token_secret, url } = authResult;
    
    console.log('Generated Twitter Auth URL:', url);
    
    // Store the oauth token secret for this oauth token
    requestTokens.set(oauth_token, oauth_token_secret);
    
    // Set a timeout to clean up the request token after 10 minutes
    setTimeout(() => {
      requestTokens.delete(oauth_token);
    }, 10 * 60 * 1000);
    
    res.json({ authUrl: url, oauth_token });
  } catch (error) {
    console.error('Auth URL error:', error?.message);
    res.status(500).json({ error: 'Failed to generate auth URL: ' + (error?.message || 'Unknown error') });
  }
});

// Twitter OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { oauth_token, oauth_verifier, denied } = req?.query || {};
    
    console.log('Twitter callback received:', { 
      hasOauthToken: !!oauth_token,
      hasOauthVerifier: !!oauth_verifier,
      denied: denied || 'none',
      tokenLength: oauth_token?.length,
      verifierLength: oauth_verifier?.length,
      query: JSON.stringify(req.query)
    });
    
    // Handle user denying the app
    if (denied) {
      console.error('Twitter auth denied by user:', denied);
      return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Authentication was denied')}`);
    }
    
    if (!oauth_token || !oauth_verifier) {
      console.error('Missing required OAuth parameters');
      console.error('Query parameters:', req.query);
      console.error('URL:', req.originalUrl);
      return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Missing required authentication parameters')}`);
    }
    
    // Check if the token exists in our storage
    if (!requestTokens.has(oauth_token)) {
      console.error('Invalid or expired OAuth token:', oauth_token);
      console.error('Available tokens:', Array.from(requestTokens.keys()));
      
      // Count how many tokens we have stored
      console.log('Number of tokens in storage:', requestTokens.size);
      
      return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Invalid or expired authorization session. Please try again.')}`);
    }
    
    console.log('Processing callback with OAuth token:', oauth_token);
    console.log('OAuth token found in storage');
    
    const tokenSecret = requestTokens.get(oauth_token);
    if (!tokenSecret) {
      console.error('Request token missing');
      return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Request token missing')}`);
    }
    
    try {
      const tokenData = await twitterService.getAccessToken(oauth_token, oauth_verifier, tokenSecret);
      
      if (!tokenData?.access_token || !tokenData?.access_token_secret) {
        console.error('Token exchange failed:', tokenData?.error || 'Unknown error');
        return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Failed to obtain access tokens. Please try again.')}`);
      }
      
      console.log('Token exchange successful, received tokens:', {
        hasAccessToken: !!tokenData.access_token,
        hasAccessTokenSecret: !!tokenData.access_token_secret,
        accessTokenPrefix: tokenData.access_token ? tokenData.access_token.substring(0, 5) + '...' : 'missing',
        accessTokenSecretPrefix: tokenData.access_token_secret ? tokenData.access_token_secret.substring(0, 5) + '...' : 'missing',
        userId: tokenData.user_id,
        username: tokenData.username
      });
      
      // Clean up the request token
      requestTokens.delete(oauth_token);
      
      // Attempt to get user profile data
      let profileData = {};
      try {
        console.log('Fetching additional user profile data...');
        const userInfo = await twitterService.getUserInfo(tokenData.access_token, tokenData.access_token_secret);
        
        console.log('User profile data fetched:', {
          hasName: !!userInfo?.name,
          hasProfileImage: !!userInfo?.profile_image_url,
          name: userInfo?.name || 'Not available',
          profileImage: userInfo?.profile_image_url ? userInfo.profile_image_url.substring(0, 30) + '...' : 'Not available'
        });
        
        if (userInfo) {
          profileData = {
            name: userInfo.name || tokenData.username, // Use username as fallback if name not available
            profile_image_url: userInfo.profile_image_url || ''
          };
        }
      } catch (profileError) {
        console.warn('Could not fetch Twitter user profile data:', profileError.message);
        // Use username as fallback for name if profile fetch fails
        profileData = {
          name: tokenData.username || '',
          profile_image_url: ''
        };
      }
      
      console.log('Final user data being sent to frontend:', {
        userId: tokenData.user_id,
        username: tokenData.username,
        name: profileData.name,
        hasProfileImage: !!profileData.profile_image_url
      });
      
      // Redirect to frontend with access token as a query parameter
      // In production, you should use a more secure method to transfer the token
      const redirectUrl = `${process.env.FRONTEND_URL}/twitter?access_token=${encodeURIComponent(tokenData.access_token)}&access_token_secret=${encodeURIComponent(tokenData.access_token_secret || '')}&user_id=${encodeURIComponent(tokenData.user_id || '')}&username=${encodeURIComponent(tokenData.username || '')}&name=${encodeURIComponent(profileData.name || '')}&profile_image_url=${encodeURIComponent(profileData.profile_image_url || '')}`;
      
      console.log('Redirecting to frontend with token data');
      res.redirect(redirectUrl);
    } catch (exchangeError) {
      console.error('Token exchange error:', exchangeError?.message);
      
      // Clean up the request token on error
      requestTokens.delete(oauth_token);
      
      if (exchangeError?.message?.includes('401') || exchangeError?.message?.includes('authentication failed')) {
        console.error('Twitter API credentials may be invalid or expired');
        
        // Check if environment variables are set
        console.log('Environment variable check:', {
          hasApiKey: !!process.env.TWITTER_API_KEY,
          hasApiSecret: !!process.env.TWITTER_API_SECRET
        });
        
        return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Twitter authentication failed. The application\'s API access may have changed. Please try again later.')}`);
      }
      
      return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Authentication failed: ' + (exchangeError?.message || 'Unknown error'))}`);
    }
  } catch (error) {
    console.error('Auth callback error:', error?.message);
    res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Authentication failed: ' + (error?.message || 'Unknown error'))}`);
  }
});

// POST /twitter/post-video
router.post('/post-video', async (req, res) => {
  try {
    console.log('=== TWITTER POST VIDEO ROUTE START ===');
    console.log('Request body:', JSON.stringify(req.body || {}, null, 2));
    
    const { videoUrl, accessToken, accessTokenSecret, text, userId } = req?.body || {};
    
    if (!videoUrl) {
      console.log('Missing required parameter: videoUrl');
      return res.status(400).json({ error: 'Video URL is required' });
    }

    // Check if we need to get tokens from the database
    let finalAccessToken = accessToken;
    let finalAccessTokenSecret = accessTokenSecret;
    
    // If tokens are missing but userId is provided, try to get tokens from the database
    if ((!finalAccessToken || !finalAccessTokenSecret) && userId) {
      console.log(`Tokens not provided in request, retrieving from database for user ${userId}`);
      try {
        const twitterTokens = await userService.getSocialMediaTokens(userId, 'twitter');
        
        // If there are tokens in the database, use the first account's tokens
        if (twitterTokens && Array.isArray(twitterTokens) && twitterTokens.length > 0) {
          const firstAccount = twitterTokens[0];
          if (firstAccount.accessToken && firstAccount.accessTokenSecret) {
            console.log(`Found Twitter tokens in database for user ${userId} (account: ${firstAccount.username || firstAccount.userId})`);
            finalAccessToken = firstAccount.accessToken;
            finalAccessTokenSecret = firstAccount.accessTokenSecret;
          }
        } else {
          console.warn(`No Twitter tokens found in database for user ${userId}`);
        }
      } catch (error) {
        console.error(`Error retrieving Twitter tokens from database:`, error?.message);
      }
    }
    
    // Check if we have the tokens we need
    if (!finalAccessToken || !finalAccessTokenSecret) {
      console.log('Missing required parameters after database lookup:', {
        hasVideoUrl: !!videoUrl,
        hasAccessToken: !!finalAccessToken,
        hasAccessTokenSecret: !!finalAccessTokenSecret
      });
      return res.status(400).json({ error: 'Twitter access token and secret are required' });
    }

    console.log('Posting video to Twitter with URL:', videoUrl);
    console.log('Twitter credentials check:', {
      hasAccessToken: !!finalAccessToken,
      hasAccessTokenSecret: !!finalAccessTokenSecret,
      accessTokenPrefix: finalAccessToken ? finalAccessToken.substring(0, 5) + '...' : 'missing',
      accessTokenSecretPrefix: finalAccessTokenSecret ? finalAccessTokenSecret.substring(0, 5) + '...' : 'missing',
      userId: userId || 'not provided'
    });

    const result = await twitterService.postMediaTweet(videoUrl, finalAccessToken, text, finalAccessTokenSecret);
    
    console.log('Twitter post result:', JSON.stringify(result || {}, null, 2));
    console.log('=== TWITTER POST VIDEO ROUTE END ===');
    
    res.status(200).json({ message: 'Video posted successfully', data: result });
  } catch (error) {
    console.error('=== TWITTER POST VIDEO ROUTE ERROR ===');
    console.error('Error posting video:', error?.message);
    console.error('Error stack:', error?.stack);
    
    // Check if this is an authentication error
    if (error?.message?.includes('authentication') || error?.message?.includes('Authentication')) {
      return res.status(401).json({ 
        error: 'Twitter authentication failed. Please reconnect your Twitter account and try again.',
        code: 'TWITTER_AUTH_ERROR'
      });
    }
    
    res.status(500).json({ error: 'Failed to post video to Twitter: ' + (error?.message || 'Unknown error') });
  }
});

// POST /twitter/post-video-multi
router.post('/post-video-multi', async (req, res) => {
  try {
    const { videoUrl, accounts, text, userId } = req?.body || {};
    
    console.log('Twitter post-video-multi request:', {
      hasVideoUrl: !!videoUrl,
      accountsCount: accounts?.length || 0,
      hasText: !!text,
      userId: userId || 'not provided',
      accountDetails: accounts?.map(acc => ({
        userId: acc.userId,
        username: acc.username || 'no username'
      }))
    });
    
    if (!videoUrl || !accounts || !Array.isArray(accounts) || accounts.length === 0) {
      console.log('Missing required parameters for multi-account posting:', {
        hasVideoUrl: !!videoUrl,
        hasAccounts: !!accounts,
        isAccountsArray: Array.isArray(accounts),
        accountsLength: Array.isArray(accounts) ? accounts.length : 0
      });
      return res.status(400).json({ error: 'Video URL and at least one account are required' });
    }

    // Check if userId is provided to fetch tokens from the database
    if (!userId) {
      console.log('Missing required parameter: userId');
      return res.status(400).json({ error: 'User ID is required to fetch Twitter tokens from the database' });
    }

    console.log('=== TWITTER POST VIDEO MULTI ROUTE START ===');
    console.log(`Posting video to ${accounts.length} Twitter accounts with URL:`, videoUrl);

    // Fetch Twitter tokens from the database for the user
    let twitterAccounts;
    try {
      console.log(`Looking up tokens for user ${userId} in the database`);
      const userTwitterData = await userService.getSocialMediaTokens(userId, 'twitter');
      
      if (!userTwitterData || (Array.isArray(userTwitterData) && userTwitterData.length === 0)) {
        console.error(`No Twitter data found for user ${userId}`);
        return res.status(404).json({ error: 'No Twitter accounts found for this user' });
      }
      
      twitterAccounts = Array.isArray(userTwitterData) ? userTwitterData : [userTwitterData];
      console.log(`Found ${twitterAccounts.length} Twitter account(s) in the database for user ${userId}`);
      
      // Log the accounts we found in the database for debugging
      console.log('Available Twitter accounts in database:', twitterAccounts.map(acc => ({
        userId: acc.userId || acc.user_id,
        username: acc.username || acc.screenName || 'no username',
        hasAccessToken: !!acc.accessToken,
        hasAccessTokenSecret: !!acc.accessTokenSecret
      })));
    } catch (error) {
      console.error(`Error fetching Twitter tokens for user ${userId}:`, error);
      return res.status(500).json({ error: 'Failed to fetch Twitter tokens from the database' });
    }

    const results = [];
    
    // Process each account in sequence
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      
      try {
        console.log(`Processing Twitter account ${i+1}/${accounts.length}: ${account.username || account.userId}`);
        
        // Try to find the matching account in the database using different possible ID field names
        const dbAccount = twitterAccounts.find(acc => 
          (acc.userId && acc.userId === account.userId) || 
          (acc.user_id && acc.user_id === account.userId)
        );
        
        if (!dbAccount) {
          console.error(`No database entry found for Twitter account: ${account.username || account.userId}`);
          console.error('Account lookup failed. Requested:', account, 'Available accounts:', twitterAccounts.map(a => a.userId || a.user_id));
          results.push({
            accountId: account.userId,
            username: account.username || '',
            success: false,
            error: 'Account not found in database'
          });
          continue;
        }
        
        // Check if we have the tokens
        if (!dbAccount.accessToken || !dbAccount.accessTokenSecret) {
          console.error(`Missing tokens for Twitter account: ${account.username || account.userId}`);
          results.push({
            accountId: account.userId,
            username: account.username || '',
            success: false,
            error: 'Missing authentication tokens for this account'
          });
          continue;
        }

        console.log(`Using Twitter tokens from database for account ${account.username || account.userId}`);
        
        // Post to Twitter with this account - use postMediaTweet instead of postVideo
        const result = await twitterService.postMediaTweet(
          videoUrl, 
          dbAccount.accessToken,
          text || '',
          dbAccount.accessTokenSecret
        );
        
        results.push({
          accountId: account.userId,
          username: account.username || '',
          success: true,
          data: result
        });
        
        // Add a small delay between account requests to avoid rate limiting
        if (i < accounts.length - 1) {
          console.log(`Waiting 3 seconds before processing next Twitter account...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } catch (error) {
        console.error(`Error posting to Twitter account ${account.username || account.userId}:`, error?.message);
        
        results.push({
          accountId: account.userId,
          username: account.username || '',
          success: false,
          error: error?.message || 'Unknown error'
        });
      }
    }
    
    console.log('Twitter multi post results:', JSON.stringify(results || {}, null, 2));
    console.log('=== TWITTER POST VIDEO MULTI ROUTE END ===');
    
    // Return the combined results
    res.status(200).json({
      success: results.some(r => r.success), // Overall success if at least one account succeeded
      message: `Posted to ${results.filter(r => r.success).length}/${accounts.length} Twitter accounts`,
      results: results
    });
  } catch (error) {
    console.error('=== TWITTER POST VIDEO MULTI ROUTE ERROR ===');
    console.error('Error posting video to multiple accounts:', error?.message);
    console.error('Error stack:', error?.stack);
    
    // Send a properly formatted JSON response
    res.status(500).json({ 
      error: 'Failed to post video to Twitter: ' + (error?.message || 'Unknown error'),
      errorCode: error?.code || 'UNKNOWN_ERROR'
    });
  }
});

// GET /twitter/user-info
router.get('/user-info', async (req, res) => {
  try {
    const { accessToken, accessTokenSecret } = req.query;
    
    if (!accessToken || !accessTokenSecret) {
      return res.status(400).json({ error: 'Access token and access token secret are required' });
    }
    
    console.log('Fetching Twitter user info with tokens');
    
    const userInfo = await twitterService.getUserInfo(accessToken, accessTokenSecret);
    
    if (!userInfo) {
      return res.status(404).json({ error: 'Failed to fetch user info' });
    }
    
    console.log('Retrieved Twitter user info:', {
      hasId: !!userInfo.id_str,
      username: userInfo.screen_name,
      name: userInfo.name,
      hasProfileImage: !!userInfo.profile_image_url
    });
    
    res.status(200).json({
      message: 'User info retrieved successfully',
      data: {
        id_str: userInfo.id_str,
        username: userInfo.screen_name,
        name: userInfo.name,
        profile_image_url: userInfo.profile_image_url_https || userInfo.profile_image_url
      }
    });
  } catch (error) {
    console.error('Error fetching Twitter user info:', error);
    res.status(500).json({ error: 'Failed to fetch Twitter user info: ' + error.message });
  }
});

module.exports = router; 