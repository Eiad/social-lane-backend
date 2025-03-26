const express = require('express');
const router = express.Router();
const tiktokService = require('../services/tiktokService');
const userService = require('../services/userService');
const axios = require('axios');
const crypto = require('crypto');

// Get TikTok auth URL
router.get('/auth', (req, res) => {
  try {
    // Add force_login=true to allow switching accounts
    const authUrl = tiktokService.getAuthUrl({
      forceLogin: true,
      state: Math.random().toString(36).substring(2)
    });
    
    // Instead of sending JSON, redirect directly to TikTok
    res.redirect(authUrl);
  } catch (error) {
    console.error('Auth URL error:', error?.message);
    res.redirect(`${process.env.FRONTEND_URL}/tiktok?error=${encodeURIComponent('Failed to generate auth URL')}`);
  }
});

// TikTok OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code, error, error_description, state, scopes } = req?.query || {};
    
    // Log the scopes that were authorized by the user
    console.log('TikTok callback received with scopes:', scopes);
    
    // Handle error from TikTok
    if (error) {
      console.error('TikTok auth error:', error, error_description);
      return res.redirect(`${process.env.FRONTEND_URL}/tiktok?error=${encodeURIComponent(error_description || 'Authentication failed')}`);
    }
    
    if (!code) {
      console.error('No authorization code provided');
      return res.redirect(`${process.env.FRONTEND_URL}/tiktok?error=${encodeURIComponent('No authorization code provided')}`);
    }

    console.log('Processing callback with code:', code);
    const tokenData = await tiktokService.getAccessToken(code);
    
    if (!tokenData || tokenData.error) {
      console.error('Token exchange failed:', tokenData?.error || 'Unknown error');
      return res.redirect(`${process.env.FRONTEND_URL}/tiktok?error=${encodeURIComponent(tokenData?.error_description || 'Token exchange failed')}`);
    }
    
    // Check if user.info.basic scope was granted
    const grantedScopes = tokenData.scope?.split(',') || [];
    console.log('Granted scopes from token response:', grantedScopes);
    
    if (!grantedScopes.includes('user.info.basic')) {
      console.warn('user.info.basic scope was not granted. User profile info may not be available.');
    }
    
    // Fetch user information immediately after getting the token
    try {
      console.log('Attempting to fetch TikTok user info with received token');
      const userInfo = await tiktokService.getUserInfo(tokenData.access_token, tokenData.refresh_token);
      
      // Add user info to the redirect URL
      const userInfoParams = userInfo ? {
        username: userInfo.username || '',
        display_name: userInfo.display_name || '',
        avatar_url: userInfo.avatar_url || '',
        avatar_url_100: userInfo.avatar_url_100 || ''
      } : {};
      
      console.log('User info retrieved successfully:', {
        hasUsername: !!userInfo?.username,
        hasDisplayName: !!userInfo?.display_name,
        hasAvatarUrl: !!userInfo?.avatar_url,
        hasAvatarUrl100: !!userInfo?.avatar_url_100
      });
      
      // Redirect to frontend with access token and user info as query parameters
      const redirectParams = new URLSearchParams({
        access_token: tokenData.access_token,
        open_id: tokenData.open_id,
        ...(tokenData.refresh_token ? { refresh_token: tokenData.refresh_token } : {}),
        ...(userInfoParams ? {
          username: userInfoParams.username,
          display_name: userInfoParams.display_name,
          avatar_url: userInfoParams.avatar_url,
          avatar_url_100: userInfoParams.avatar_url_100
        } : {})
      });
      
      const redirectUrl = `${process.env.FRONTEND_URL}/tiktok?${redirectParams.toString()}`;
      res.redirect(redirectUrl);
    } catch (userInfoError) {
      console.error('Error fetching user info after token exchange:', userInfoError);
      console.error('Error details:', userInfoError?.response?.data || userInfoError?.message);
      
      // Continue with the redirect even if user info fetch fails
      const redirectUrl = `${process.env.FRONTEND_URL}/tiktok?access_token=${encodeURIComponent(tokenData.access_token)}&open_id=${encodeURIComponent(tokenData.open_id)}${tokenData.refresh_token ? `&refresh_token=${encodeURIComponent(tokenData.refresh_token)}` : ''}`;
      res.redirect(redirectUrl);
    }
  } catch (error) {
    console.error('Auth callback error:', error?.message);
    res.redirect(`${process.env.FRONTEND_URL}/tiktok?error=${encodeURIComponent('Authentication failed: ' + (error?.message || 'Unknown error'))}`);
  }
});

// POST /tiktok/post-video
router.post('/post-video', async (req, res) => {
  try {
    const { videoUrl, accessToken, refreshToken, caption, userId, accountId } = req?.body || {};
    
    // Check for either direct token access or userId+accountId lookup
    if (!videoUrl) {
      console.log('Missing required parameter:', {
        hasVideoUrl: !!videoUrl
      });
      return res.status(400).json({ error: 'Video URL is required' });
    }

    // If tokens provided directly, use them
    let finalAccessToken = accessToken;
    let finalRefreshToken = refreshToken;
    
    // If userId is provided but no accessToken, try to look up tokens from database
    if (!finalAccessToken && userId) {
      try {
        console.log(`Looking up tokens for user ${userId} in the database`);
        
        // Import User model
        const User = require('../models/User');
        
        // Fetch user from database
        const user = await User.findOne({ uid: userId });
        
        if (!user || !user.providerData || !user.providerData.tiktok || !user.providerData.tiktok.length) {
          console.error(`No TikTok accounts found for user ${userId} in database`);
          return res.status(400).json({ error: 'No TikTok accounts found. Please connect a TikTok account.' });
        }
        
        // If accountId is provided, find that specific account
        let dbAccount;
        if (accountId) {
          dbAccount = user.providerData.tiktok.find(acc => acc.openId === accountId);
          if (!dbAccount) {
            console.error(`No matching TikTok account found for accountId ${accountId}`);
            return res.status(404).json({ error: 'TikTok account not found. Please reconnect your account.' });
          }
        } else {
          // Otherwise, use the first account
          dbAccount = user.providerData.tiktok[0];
        }
        
        if (!dbAccount.accessToken) {
          console.error('TikTok account found but has no access token');
          return res.status(401).json({ error: 'Invalid TikTok account. Please reconnect your account.' });
        }
        
        console.log(`Using TikTok tokens from database for account ${dbAccount.username || dbAccount.openId}`);
        finalAccessToken = dbAccount.accessToken;
        finalRefreshToken = dbAccount.refreshToken;
      } catch (lookupError) {
        console.error('Error looking up TikTok tokens:', lookupError);
        return res.status(500).json({ error: 'Failed to retrieve TikTok credentials: ' + lookupError.message });
      }
    }
    
    // Final check - we need an access token by this point
    if (!finalAccessToken) {
      console.log('Missing required parameters after database lookup:', {
        hasVideoUrl: !!videoUrl,
        hasAccessToken: !!finalAccessToken
      });
      return res.status(400).json({ error: 'TikTok access token is required' });
    }

    console.log('=== TIKTOK POST VIDEO ROUTE START ===');
    console.log('Posting video to TikTok with URL:', videoUrl);

    try {
      const result = await tiktokService.postVideo(videoUrl, finalAccessToken, caption, finalRefreshToken);
      
      console.log('TikTok post result:', JSON.stringify(result || {}, null, 2));
      console.log('=== TIKTOK POST VIDEO ROUTE END ===');
      
      res.status(200).json({ message: 'Video posted successfully to TikTok', data: result });
    } catch (error) {
      console.error('TikTok API error:', error?.message);
      
      if (error.response) {
        console.error('TikTok API error response:', error.response?.status, error.response?.statusText);
        console.error('TikTok API error data:', error.response?.data);
      }
      
      // Check if this is an authentication error
      if (error?.message?.includes('auth') || error?.message?.includes('token')) {
        return res.status(401).json({ 
          error: 'TikTok authentication failed. Please reconnect your TikTok account and try again.',
          code: 'TIKTOK_AUTH_ERROR'
        });
      }
      
      res.status(500).json({ 
        error: 'Failed to post video to TikTok: ' + (error?.message || 'Unknown error'),
        code: error?.code || 'UNKNOWN_ERROR'
      });
    }
  } catch (error) {
    console.error('=== TIKTOK POST VIDEO ROUTE ERROR ===');
    console.error('Error posting video:', error?.message);
    console.error('Error stack:', error?.stack);
    
    res.status(500).json({ error: 'Failed to post video to TikTok: ' + (error?.message || 'Unknown error') });
  }
});

// POST /tiktok/post-video-multi
router.post('/post-video-multi', async (req, res) => {
  try {
    const { videoUrl, accounts, caption, userId } = req?.body || {};
    
    if (!videoUrl || !accounts || !Array.isArray(accounts) || accounts.length === 0) {
      console.log('Missing required parameters for multi-account posting:', {
        hasVideoUrl: !!videoUrl,
        hasAccounts: !!accounts,
        isAccountsArray: Array.isArray(accounts),
        accountsLength: Array.isArray(accounts) ? accounts.length : 0
      });
      return res.status(400).json({ error: 'Video URL and at least one account are required' });
    }

    console.log('=== TIKTOK POST VIDEO MULTI ROUTE START ===');
    console.log(`Posting video to ${accounts.length} TikTok accounts with URL:`, videoUrl);

    const results = [];
    
    // If userId is provided, we need to look up the actual tokens from database
    let tokenizedAccounts = accounts;
    
    if (userId && accounts.some(account => account.accountId && !account.accessToken)) {
      // We need to fetch tokens from the database
      try {
        console.log(`Looking up tokens for user ${userId} in the database`);
        
        // Import User model
        const User = require('../models/User');
        
        // Fetch user from database
        const user = await User.findOne({ uid: userId });
        
        if (!user || !user.providerData || !user.providerData.tiktok) {
          console.error(`No TikTok accounts found for user ${userId} in database`);
          throw new Error('No TikTok tokens found in database. Please reconnect your TikTok account.');
        }
        
        console.log(`Found ${user.providerData.tiktok.length} TikTok accounts in database`);
        
        // Match requested account IDs with database tokens
        tokenizedAccounts = accounts.map(account => {
          // Find matching account in database
          const dbAccount = user.providerData.tiktok.find(
            dbAcc => dbAcc.openId === account.accountId
          );
          
          if (!dbAccount || !dbAccount.accessToken) {
            console.warn(`No matching database tokens found for account ${account.accountId}`);
            return {
              ...account,
              foundInDb: false
            };
          }
          
          console.log(`Found database tokens for account ${account.accountId}`);
          
          // Return account with tokens from database
          return {
            accessToken: dbAccount.accessToken,
            openId: dbAccount.openId,
            refreshToken: dbAccount.refreshToken || '',
            displayName: account.displayName || dbAccount.displayName || dbAccount.username || '',
            username: account.username || dbAccount.username || '',
            foundInDb: true
          };
        });
        
        // Filter out accounts without tokens
        const validAccounts = tokenizedAccounts.filter(account => account.foundInDb && account.accessToken);
        
        if (validAccounts.length === 0) {
          throw new Error('No valid TikTok accounts with tokens found');
        }
        
        console.log(`Successfully retrieved tokens for ${validAccounts.length}/${accounts.length} accounts`);
        
        // Update tokenizedAccounts to only valid ones
        tokenizedAccounts = validAccounts;
      } catch (tokenError) {
        console.error('Error retrieving tokens from database:', tokenError?.message);
        throw new Error('Failed to retrieve TikTok tokens: ' + tokenError?.message);
      }
    }
    
    // Process each account in sequence
    for (let i = 0; i < tokenizedAccounts.length; i++) {
      const account = tokenizedAccounts[i];
      
      try {
        console.log(`Processing TikTok account ${i+1}/${tokenizedAccounts.length}: ${account.displayName || account.openId}`);
        
        // Post to TikTok with this account
        const result = await tiktokService.postVideo(
          videoUrl, 
          account.accessToken, 
          caption, 
          account.refreshToken
        );
        
        results.push({
          accountId: account.openId,
          displayName: account.displayName || '',
          success: true,
          data: result
        });
        
        // Add a small delay between account requests to avoid rate limiting
        if (i < tokenizedAccounts.length - 1) {
          console.log(`Waiting 3 seconds before processing next TikTok account...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } catch (error) {
        console.error(`Error posting to TikTok account ${account.displayName || account.openId}:`, error?.message);
        
        results.push({
          accountId: account.openId,
          displayName: account.displayName || '',
          success: false,
          error: error?.message || 'Unknown error'
        });
      }
    }
    
    console.log('TikTok multi post results:', JSON.stringify(results || {}, null, 2));
    console.log('=== TIKTOK POST VIDEO MULTI ROUTE END ===');
    
    // Return the combined results
    res.status(200).json({
      success: results.some(r => r.success), // Overall success if at least one account succeeded
      message: `Posted to ${results.filter(r => r.success).length}/${tokenizedAccounts.length} TikTok accounts`,
      results: results
    });
  } catch (error) {
    console.error('=== TIKTOK POST VIDEO MULTI ROUTE ERROR ===');
    console.error('Error posting video to multiple accounts:', error?.message);
    console.error('Error stack:', error?.stack);
    
    // Send a properly formatted JSON response
    res.status(500).json({ 
      error: 'Failed to post video to TikTok: ' + (error?.message || 'Unknown error'),
      errorCode: error?.code || 'UNKNOWN_ERROR'
    });
  }
});

// GET /tiktok/user-info
router.get('/user-info', async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.split('Bearer ')?.[1];
    const refreshToken = req.headers['x-refresh-token'];
    
    if (!accessToken) {
      return res.status(401).json({ error: 'No access token provided' });
    }

    // Add CORS headers
    res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL);
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Authorization, X-Refresh-Token, Content-Type');
    res.header('Access-Control-Allow-Credentials', 'true');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const userInfo = await tiktokService.getUserInfo(accessToken, refreshToken);
    res.json({ data: userInfo });
  } catch (error) {
    console.error('Error getting user info:', error?.message);
    res.status(500).json({ error: 'Failed to get user info: ' + (error?.message || 'Unknown error') });
  }
});

module.exports = router;