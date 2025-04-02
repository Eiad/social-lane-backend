// File: routes/tiktok.js
const express = require('express');
const router = express.Router();
const tiktokService = require('../services/tiktokService');
const userService = require('../services/userService');
const axios = require('axios');
const crypto = require('crypto');

// --- getAuthUrl, callback, getUserInfo routes remain the same ---
// --- (Code for those routes omitted for brevity, but keep them in your actual file) ---
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
      return res.redirect(`${process.env.FRONTEND_URL}/tiktok?connection_error=${encodeURIComponent(error_description || 'Authentication failed')}`);
    }

    if (!code) {
      console.error('No authorization code provided');
      return res.redirect(`${process.env.FRONTEND_URL}/tiktok?error=${encodeURIComponent('No authorization code provided')}`);
    }

    console.log('Processing callback with code:', code);
    const tokenData = await tiktokService.getAccessToken(code);

    if (!tokenData || tokenData.error) {
      console.error('Token exchange failed:', tokenData?.error || 'Unknown error');
      return res.redirect(`${process.env.FRONTEND_URL}/tiktok?connection_error=${encodeURIComponent(tokenData?.error_description || 'Token exchange failed')}`);
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
        refresh_token: tokenData.refresh_token || '',
        ...(userInfo ? { user_info: encodeURIComponent(JSON.stringify(userInfo)) } : {})
      });

      const redirectUrl = `${process.env.FRONTEND_URL}/tiktok?${redirectParams.toString()}&auth_success=true`;
      res.redirect(redirectUrl);
    } catch (userInfoError) {
      console.error('Error fetching user info after token exchange:', userInfoError);
      console.error('Error details:', userInfoError?.response?.data || userInfoError?.message);

      // Continue with the redirect even if user info fetch fails
       // Pass open_id and tokens even if user info fails
        const redirectParams = new URLSearchParams({
            access_token: tokenData.access_token,
            open_id: tokenData.open_id,
            refresh_token: tokenData.refresh_token || '',
            user_info_error: encodeURIComponent(userInfoError.message || 'Failed to fetch profile')
        });
       const redirectUrl = `${process.env.FRONTEND_URL}/tiktok?${redirectParams.toString()}`;
      res.redirect(redirectUrl);
    }
  } catch (error) {
    console.error('Auth callback error:', error?.message);
    res.redirect(`${process.env.FRONTEND_URL}/tiktok?connection_error=${encodeURIComponent('Authentication failed: ' + (error?.message || 'Unknown error'))}`);
  }
});


// POST /tiktok/post-video (Single Account Post)
router.post('/post-video', async (req, res) => {
  try {
    const { videoUrl, accessToken, refreshToken, caption, userId, accountId } = req?.body || {};
    let finalAccessToken = accessToken;
    let finalRefreshToken = refreshToken;
    let finalUserId = userId;
    let finalOpenId = accountId; // Use accountId from request as the target openId

    console.log('[TIKTOK ROUTE - POST] Received single post request. UserID:', finalUserId, 'Target AccountID:', finalOpenId);

    // Validate required videoUrl
    if (!videoUrl) {
      console.log('[TIKTOK ROUTE - POST] Missing videoUrl');
      return res.status(400).json({ success: false, error: 'Video URL is required' });
    }

    // If userId is provided, lookup tokens from the database
    if (finalUserId) {
      try {
        console.log(`[TIKTOK ROUTE - POST] Looking up tokens for user ${finalUserId}`);
        const user = await User.findOne({ uid: finalUserId });

        if (!user || !user.providerData?.tiktok?.length) {
          console.error(`[TIKTOK ROUTE - POST] No TikTok accounts found for user ${finalUserId} in DB.`);
          return res.status(404).json({ success: false, error: 'No TikTok accounts found for user.' });
        }

        let dbAccount;
        if (finalOpenId) {
          // Find the specific account requested
          dbAccount = user.providerData.tiktok.find(acc => acc.openId === finalOpenId);
          if (!dbAccount) {
            console.error(`[TIKTOK ROUTE - POST] Account ${finalOpenId} not found for user ${finalUserId}.`);
            return res.status(404).json({ success: false, error: `TikTok account ${finalOpenId} not found.` });
          }
           console.log(`[TIKTOK ROUTE - POST] Found specific account ${finalOpenId} for user ${finalUserId}.`);
        } else {
          // If no specific accountId, use the first one (maintaining previous behavior)
          dbAccount = user.providerData.tiktok[0];
          finalOpenId = dbAccount.openId; // Set the openId for potential token update later
          console.log(`[TIKTOK ROUTE - POST] No specific accountId provided, using first account: ${finalOpenId}`);
        }

        if (!dbAccount.accessToken) {
          console.error(`[TIKTOK ROUTE - POST] Account ${finalOpenId} has no access token.`);
          return res.status(401).json({ success: false, error: 'Invalid TikTok account credentials. Please reconnect.' });
        }

        console.log(`[TIKTOK ROUTE - POST] Using tokens from DB for account ${finalOpenId}`);
        finalAccessToken = dbAccount.accessToken;
        finalRefreshToken = dbAccount.refreshToken; // Get the refresh token from DB

      } catch (lookupError) {
        console.error('[TIKTOK ROUTE - POST] Error looking up TikTok tokens:', lookupError);
        return res.status(500).json({ success: false, error: 'Failed to retrieve TikTok credentials.' });
      }
    }

    // Final check for access token
    if (!finalAccessToken) {
      console.error('[TIKTOK ROUTE - POST] No access token available after potential DB lookup.');
      return res.status(400).json({ success: false, error: 'TikTok access token is required.' });
    }

    console.log('[TIKTOK ROUTE - POST] === TIKTOK POST VIDEO ROUTE START ===');
    console.log('[TIKTOK ROUTE - POST] Posting video:', videoUrl);

    try {
      // Call the service function to post the video
      const result = await tiktokService.postVideo(
        videoUrl,
        finalAccessToken,
        caption,
        finalRefreshToken // Pass the refresh token
      );

      // Check if tokens were refreshed during the posting process
      if (result.tokensRefreshed && finalUserId && finalOpenId) {
        console.log(`[TIKTOK ROUTE - POST] Tokens were refreshed for account ${finalOpenId}. Updating DB.`);
        try {
          await userService.updateTikTokTokens(
            finalUserId,
            finalOpenId,
            result.newAccessToken,
            result.newRefreshToken // Pass the potentially new refresh token
          );
          console.log('[TIKTOK ROUTE - POST] User tokens updated successfully in DB.');
        } catch (updateError) {
          console.error('[TIKTOK ROUTE - POST] Failed to update refreshed tokens in DB:', updateError);
          // Log error but continue - the post was successful
        }
      }

      console.log('[TIKTOK ROUTE - POST] TikTok post result:', JSON.stringify(result || {}, null, 2));
      console.log('[TIKTOK ROUTE - POST] === TIKTOK POST VIDEO ROUTE END ===');

      res.status(200).json({
        success: true,
        message: 'Video posted successfully to TikTok',
        data: result,
        tokensRefreshed: result.tokensRefreshed || false // Include refresh status in response
      });

    } catch (postError) {
      console.error('[TIKTOK ROUTE - POST] TikTok API post error:', postError.message);
       // Log the detailed error structure if available
       if (postError.response) {
           console.error('[TIKTOK ROUTE - POST] Error Response Status:', postError.response.status);
           console.error('[TIKTOK ROUTE - POST] Error Response Data:', postError.response.data);
       } else {
           console.error('[TIKTOK ROUTE - POST] Error does not have response object:', postError);
       }

      // Determine appropriate status code based on error type
      let statusCode = 500;
      let errorCode = 'TIKTOK_POST_FAILED';
      let userMessage = `Failed to post video to TikTok: ${postError.message || 'Unknown error'}`;


       if (postError.message?.includes('reconnect your TikTok account')) {
           statusCode = 401; // Unauthorized
           errorCode = 'TIKTOK_AUTH_ERROR';
           userMessage = 'TikTok authorization failed or token expired. Please reconnect your TikTok account.';
       } else if (postError.message?.includes('permissions') || postError.message?.includes('scope')) {
           statusCode = 403; // Forbidden
           errorCode = 'TIKTOK_PERMISSION_ERROR';
           userMessage = 'Missing necessary TikTok permissions. Please reconnect your account and grant all requested permissions.';
       } else if (postError.message?.includes('rate limit')) {
           statusCode = 429; // Too Many Requests
           errorCode = 'TIKTOK_RATE_LIMIT';
       } else if (postError.message?.includes('download video') || postError.message?.includes('video URL')) {
            statusCode = 400; // Bad Request
            errorCode = 'TIKTOK_VIDEO_URL_ERROR';
       } else if (postError.message?.includes('resolution') || postError.message?.includes('aspect ratio') || postError.message?.includes('video format')) {
            statusCode = 400;
            errorCode = 'TIKTOK_VIDEO_FORMAT_ERROR';
       }


      res.status(statusCode).json({
        success: false,
        error: userMessage,
        code: errorCode,
         details: postError.message // Include original message for debugging if needed
      });
    }
  } catch (error) {
    console.error('[TIKTOK ROUTE - POST] Unexpected error in route handler:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});


// POST /tiktok/post-video-multi
router.post('/post-video-multi', async (req, res) => {
  try {
    const { videoUrl, accounts, caption, userId } = req?.body || {};

    console.log('[TIKTOK ROUTE - MULTI] Received multi-post request. UserID:', userId, 'Accounts:', accounts?.length);

    // Validate required fields
    if (!videoUrl || !accounts || !Array.isArray(accounts) || accounts.length === 0 || !userId) {
      console.error('[TIKTOK ROUTE - MULTI] Missing required parameters.');
      return res.status(400).json({ success: false, error: 'Video URL, User ID, and at least one account are required.' });
    }

    console.log('[TIKTOK ROUTE - MULTI] === TIKTOK POST VIDEO MULTI ROUTE START ===');
    console.log(`[TIKTOK ROUTE - MULTI] Posting video to ${accounts.length} accounts.`);

    let dbAccounts = [];
    try {
      // Fetch all TikTok accounts for the user from DB once
      console.log(`[TIKTOK ROUTE - MULTI] Fetching all TikTok tokens for user ${userId} from DB.`);
      const User = require('../models/User'); // Ensure model is required
      const user = await User.findOne({ uid: userId });
      if (!user || !user.providerData?.tiktok?.length) {
        throw new Error('No TikTok accounts found in database for user.');
      }
      dbAccounts = user.providerData.tiktok;
      console.log(`[TIKTOK ROUTE - MULTI] Found ${dbAccounts.length} accounts in DB.`);
    } catch (dbError) {
      console.error('[TIKTOK ROUTE - MULTI] Error fetching user accounts from DB:', dbError);
      return res.status(500).json({ success: false, error: 'Failed to retrieve user account credentials.' });
    }

    const results = [];

    // Process each account sequentially
    for (let i = 0; i < accounts.length; i++) {
      const requestedAccount = accounts[i];
      const accountId = requestedAccount.accountId || requestedAccount.openId; // Use provided ID
      const accountDisplayName = requestedAccount.displayName || requestedAccount.username || accountId;

      console.log(`\n[TIKTOK ROUTE - MULTI] Processing account ${i + 1}/${accounts.length}: ${accountDisplayName}`);

      // Find the corresponding account in the DB data
      const dbAccount = dbAccounts.find(dbAcc => dbAcc.openId === accountId);

      if (!dbAccount || !dbAccount.accessToken) {
        console.warn(`[TIKTOK ROUTE - MULTI] Tokens not found or invalid in DB for account ${accountId}. Skipping.`);
        results.push({
          accountId: accountId,
          displayName: accountDisplayName,
          success: false,
          error: 'Account credentials not found or invalid in database.'
        });
         // Add delay even if skipping
         if (i < accounts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000)); // 3 sec delay
        }
        continue; // Move to the next account
      }

      console.log(`[TIKTOK ROUTE - MULTI] Found credentials for ${accountDisplayName}. RefreshToken available: ${!!dbAccount.refreshToken}`);

      try {
        // Call the service function to post the video for this account
        const result = await tiktokService.postVideo(
          videoUrl,
          dbAccount.accessToken,
          caption,
          dbAccount.refreshToken // Pass the refresh token from DB
        );

        results.push({
          accountId: accountId,
          displayName: accountDisplayName,
          success: true,
          data: result,
          tokensRefreshed: result.tokensRefreshed || false // Include refresh status
        });
        console.log(`[TIKTOK ROUTE - MULTI] Successfully posted to ${accountDisplayName}.`);

        // If tokens were refreshed, update the DB immediately for this account
        if (result.tokensRefreshed) {
          console.log(`[TIKTOK ROUTE - MULTI] Tokens refreshed for ${accountDisplayName}. Updating DB.`);
          try {
            await userService.updateTikTokTokens(
              userId,
              accountId,
              result.newAccessToken,
              result.newRefreshToken // Pass potentially new refresh token
            );
            console.log(`[TIKTOK ROUTE - MULTI] DB tokens updated for ${accountDisplayName}.`);
             // Update the dbAccounts array in memory in case this token is needed again later in the loop (unlikely but safe)
             const indexInDb = dbAccounts.findIndex(a => a.openId === accountId);
              if(indexInDb !== -1) {
                 dbAccounts[indexInDb].accessToken = result.newAccessToken;
                 dbAccounts[indexInDb].refreshToken = result.newRefreshToken;
              }

          } catch (updateError) {
            console.error(`[TIKTOK ROUTE - MULTI] Failed to update refreshed DB tokens for ${accountDisplayName}:`, updateError);
            // Log error but continue
          }
        }

      } catch (postError) {
        console.error(`[TIKTOK ROUTE - MULTI] Error posting to ${accountDisplayName}:`, postError.message);
        let errorDetails = postError.message || 'Unknown error during posting.';
         let errorCode = 'TIKTOK_POST_FAILED';

         if (postError.message?.includes('reconnect your TikTok account')) {
             errorCode = 'TIKTOK_AUTH_ERROR';
             errorDetails = 'Authorization failed or token expired. Please reconnect this TikTok account.';
         } else if (postError.message?.includes('permissions') || postError.message?.includes('scope')) {
            errorCode = 'TIKTOK_PERMISSION_ERROR';
            errorDetails = 'Missing necessary TikTok permissions for this account.';
         }

        results.push({
          accountId: accountId,
          displayName: accountDisplayName,
          success: false,
          error: errorDetails,
           code: errorCode
        });
      }

      // Add delay between posts unless it's the last one
      if (i < accounts.length - 1) {
        console.log('[TIKTOK ROUTE - MULTI] Waiting 3 seconds before next account...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } // End for loop

    console.log('[TIKTOK ROUTE - MULTI] TikTok multi-post processing complete.');
    console.log('[TIKTOK ROUTE - MULTI] === TIKTOK POST VIDEO MULTI ROUTE END ===');

    // Determine overall status and message
    const successfulPosts = results.filter(r => r.success).length;
    const overallSuccess = successfulPosts > 0;
    const message = `Posted to ${successfulPosts}/${accounts.length} TikTok accounts.`;

     // Use 207 Multi-Status if there were partial successes/failures
     const statusCode = successfulPosts > 0 && successfulPosts < accounts.length ? 207 : 200;


    res.status(statusCode).json({
      success: overallSuccess,
      message: message,
      results: results
    });

  } catch (error) {
    console.error('[TIKTOK ROUTE - MULTI] Unexpected error in multi-post route handler:', error);
    res.status(500).json({ success: false, error: 'Internal server error processing multi-account post.' });
  }
});


// GET /tiktok/user-info
router.get('/user-info', async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.split('Bearer ')?.[1];
    const refreshToken = req.headers['x-refresh-token']; // Get refresh token from custom header

    if (!accessToken) {
      return res.status(401).json({ error: 'No access token provided' });
    }

    // Add CORS headers
    res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'https://sociallane-frontend.mindio.chat');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Authorization, X-Refresh-Token, Content-Type');
    res.header('Access-Control-Allow-Credentials', 'true');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }


    // Try to get user info
    let userInfo = null;
     let needsReconnect = false;
     let errorMessage = 'Failed to get user info';


    try {
       userInfo = await tiktokService.getUserInfo(accessToken, refreshToken);
     } catch (error) {
         console.warn("[TIKTOK ROUTE - USER INFO] Initial getUserInfo failed:", error.message);
         // Check if it's an expired token error and we have a refresh token
          if (error.message?.includes('expired') && refreshToken) {
             console.log("[TIKTOK ROUTE - USER INFO] Access token expired, attempting refresh...");
             try {
                 const refreshed = await tiktokService.refreshTikTokToken(refreshToken);
                 console.log("[TIKTOK ROUTE - USER INFO] Refresh successful, retrying getUserInfo...");
                 // Retry getUserInfo with the new token
                 userInfo = await tiktokService.getUserInfo(refreshed.accessToken, refreshed.refreshToken);
                  // Optionally: Update the user's tokens in the database here if needed,
                  // though usually this is done during posting actions.
             } catch (refreshError) {
                 console.error("[TIKTOK ROUTE - USER INFO] Token refresh failed:", refreshError.message);
                 if (refreshError.message.includes('reconnect your TikTok account')) {
                    needsReconnect = true;
                     errorMessage = refreshError.message; // Use the specific error from refresh
                 } else {
                     errorMessage = `Failed to get user info after token refresh attempt: ${refreshError.message}`;
                 }
             }
          } else if (error.message?.includes('invalid')) {
              needsReconnect = true;
              errorMessage = 'TikTok authorization invalid. Please reconnect your account.';
          }
          else {
             // Use the original error message if not a token issue or no refresh token
              errorMessage = `Failed to get user info: ${error.message || 'Unknown error'}`;
          }
     }


     if (needsReconnect) {
        return res.status(401).json({ error: errorMessage, code: 'RECONNECT_REQUIRED' });
     }


    if (!userInfo) {
         return res.status(500).json({ error: errorMessage });
     }

    res.json({ data: userInfo });
  } catch (error) {
     // This catch block might be redundant now but keep for safety
    console.error('Error getting user info in route:', error?.message);
     let statusCode = 500;
     if (error.message?.includes('reconnect')) statusCode = 401;
    res.status(statusCode).json({ error: 'Failed to get user info: ' + (error?.message || 'Unknown error') });
  }
});


module.exports = router;