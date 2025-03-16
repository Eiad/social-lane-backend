const cron = require('node-cron');
const Post = require('../models/Post');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// Initialize the scheduler
const initScheduler = () => {
  console.log('Initializing post scheduler...');
  
  // Run every minute to check for posts that need to be published
  cron.schedule('* * * * *', async () => {
    try {
      // Find posts that are scheduled and due for publishing
      const now = new Date();
      console.log('Running scheduler check at', now.toISOString());
      
      const posts = await Post.find({
        isScheduled: true,
        scheduledDate: { $lte: now },
        status: 'pending'
      }).lean(); // Using lean() to get plain JS objects for better debugging
      
      if (posts.length > 0) {
        console.log(`Found ${posts.length} scheduled posts to publish`);
        
        // Process each post
        for (const post of posts) {
          try {
            // Debug log the post structure
            console.log('Processing scheduled post:', {
              id: post._id,
              platforms: post.platforms,
              has_tiktok_accounts: !!post.tiktok_accounts,
              tiktok_accounts_count: post.tiktok_accounts?.length || 0,
              has_legacy_tiktok: !!post.tiktok_access_token,
              has_twitter: !!post.twitter_access_token
            });
            
            if (post.tiktok_accounts) {
              console.log('TikTok accounts found in post:', 
                post.tiktok_accounts.map(acc => ({
                  openId: acc.openId,
                  hasAccessToken: !!acc.accessToken,
                  hasRefreshToken: !!acc.refreshToken
                }))
              );
            }
            
            // Update status to processing
            await Post.updateOne({ _id: post._id }, { status: 'processing' });
            
            // Process the post
            await processPost(post);
            
            // Update status to completed
            await Post.updateOne({ _id: post._id }, { status: 'completed' });
            
            console.log(`Successfully published scheduled post: ${post._id}`);
          } catch (error) {
            console.error(`Error publishing scheduled post ${post._id}:`, error?.message);
            
            // Update status to failed
            await Post.updateOne({ _id: post._id }, { status: 'failed' });
          }
        }
      }
    } catch (error) {
      console.error('Error in scheduler:', error?.message);
    }
  });
  
  // Run every 15 minutes to check for expired subscriptions
  cron.schedule('*/15 * * * *', async () => {
    try {
      const now = new Date();
      console.log('Running subscription expiration check at', now.toISOString());
      
      // Find users with Pro role and expired subscriptionEndDate
      const expiredUsers = await User.find({
        role: 'Pro',
        subscriptionEndDate: { $lt: now },
        'subscription.status': 'CANCELLED'
      });
      
      console.log(`Query criteria: role='Pro', subscriptionEndDate < ${now.toISOString()}, subscription.status='CANCELLED'`);
      
      if (expiredUsers.length > 0) {
        console.log(`Found ${expiredUsers.length} users with expired Pro subscriptions`);
        
        // Log all expired users for debugging
        expiredUsers.forEach(user => {
          console.log(`Expired subscription: User ${user.uid} (${user.email}), Role: ${user.role}, End date: ${user.subscriptionEndDate}, Current date: ${now.toISOString()}`);
        });
        
        // Downgrade each user
        for (const user of expiredUsers) {
          try {
            console.log(`Downgrading user ${user.uid} from Pro to Free (subscription ended on ${user.subscriptionEndDate})`);
            
            await User.updateOne(
              { _id: user._id },
              { 
                role: 'Free',
                $set: {
                  'subscription.status': 'EXPIRED'
                }
              }
            );
            
            console.log(`Successfully downgraded user ${user.uid} to Free plan`);
          } catch (error) {
            console.error(`Error downgrading user ${user.uid}:`, error?.message);
          }
        }
      } else {
        console.log('No users with expired Pro subscriptions found');
        
        // For debugging, find all Pro users with CANCELLED status
        const allCancelledProUsers = await User.find({
          role: 'Pro',
          'subscription.status': 'CANCELLED'
        });
        
        console.log(`Found ${allCancelledProUsers.length} Pro users with CANCELLED status`);
        
        allCancelledProUsers.forEach(user => {
          const endDate = user.subscriptionEndDate;
          const isExpired = endDate && endDate < now;
          console.log(`Cancelled Pro user: ${user.uid} (${user.email}), End date: ${endDate}, Current date: ${now.toISOString()}, Is expired: ${isExpired}`);
        });
      }
    } catch (error) {
      console.error('Error in subscription expiration checker:', error?.message);
    }
  });
  
  console.log('Post scheduler initialized');
  console.log('Subscription expiration checker initialized');
};

// Process a post by publishing to selected platforms
const processPost = async (post) => {
  const { 
    video_url, 
    post_description, 
    platforms, 
    userId,
    tiktok_accounts,
    tiktok_access_token,
    tiktok_refresh_token,
    twitter_access_token,
    twitter_access_token_secret,
    twitter_refresh_token
  } = post;
  
  if (!video_url || !platforms || platforms.length === 0) {
    throw new Error('Invalid post data');
  }
  
  console.log('Post data for processing:', {
    video_url: !!video_url,
    post_description: !!post_description,
    platforms,
    has_tiktok_accounts: !!tiktok_accounts,
    tiktok_accounts_count: tiktok_accounts?.length || 0,
    has_legacy_tiktok: !!tiktok_access_token,
    has_twitter: !!twitter_access_token && !!twitter_access_token_secret,
    has_twitter_refresh: !!twitter_refresh_token
  });
  
  const results = {};
  let tokenUpdates = {};
  
  for (const platform of platforms) {
    try {
      console.log('Processing platform:', platform);
      
      // Add delay between platforms if not the first platform
      if (platform !== platforms[0]) {
        const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
        console.log(`Waiting 5 seconds for next social media platform post (${platformName})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      if (platform === 'tiktok') {
        // TikTok posting logic (multiple accounts)
        if (tiktok_accounts && tiktok_accounts.length > 0) {
          console.log(`Found ${tiktok_accounts.length} TikTok accounts to post to`);
          
          const accountResults = [];
          
          for (let i = 0; i < tiktok_accounts.length; i++) {
            const account = tiktok_accounts[i];
            console.log(`TikTok account ${i + 1}:`, {
              openId: account.openId,
              hasAccessToken: !!account.accessToken,
              hasRefreshToken: !!account.refreshToken
            });
            
            try {
              console.log(`Posting to TikTok account with ID ${account.openId}`);
              const accountResult = await postToTikTok(
                video_url, 
                post_description, 
                account.accessToken, 
                account.refreshToken
              );
              
              accountResults.push({ 
                success: true, 
                accountId: account.openId,
                ...accountResult 
              });
              
              console.log(`TikTok posting completed successfully for account ${account.openId}`);
              
              // Add a 5-second delay between accounts if not the last account
              if (i < tiktok_accounts.length - 1) {
                console.log(`Waiting 5 seconds for next social media account post (TikTok account: ${tiktok_accounts[i+1].openId})`);
                await new Promise(resolve => setTimeout(resolve, 5000));
              }
            } catch (accountError) {
              console.error(`Error posting to TikTok account ${account.openId}:`, accountError?.message);
              accountResults.push({ 
                success: false, 
                accountId: account.openId,
                error: accountError?.message 
              });
              
              // Still add delay even if posting failed
              if (i < tiktok_accounts.length - 1) {
                console.log(`Waiting 5 seconds for next social media account post (TikTok account: ${tiktok_accounts[i+1].openId})`);
                await new Promise(resolve => setTimeout(resolve, 5000));
              }
            }
          }
          
          results.tiktok = accountResults;
        }
        // Fallback to legacy single account
        else if (tiktok_access_token) {
          console.log('Using legacy TikTok credentials format');
          try {
            const tiktokResult = await postToTikTok(
              video_url, 
              post_description, 
              tiktok_access_token, 
              tiktok_refresh_token
            );
            results.tiktok = [{ 
              success: true, 
              accountId: 'legacy',
              ...tiktokResult 
            }];
            console.log('TikTok posting completed successfully using legacy format');
          } catch (accountError) {
            console.error('Error posting to TikTok using legacy format:', accountError?.message);
            results.tiktok = [{ 
              success: false, 
              accountId: 'legacy',
              error: accountError?.message 
            }];
          }
        } else {
          console.warn('No TikTok credentials found for scheduled post');
        }
      }
      else if (platform === 'twitter' && twitter_access_token && twitter_access_token_secret) {
        // Post to Twitter using legacy single account format (for backward compatibility)
        try {
          console.log('Posting to Twitter with legacy credentials:', { 
            hasAccessToken: !!twitter_access_token, 
            hasAccessTokenSecret: !!twitter_access_token_secret,
            hasRefreshToken: !!twitter_refresh_token
          });
          
          const twitterResult = await postToTwitter(video_url, post_description, twitter_access_token, twitter_access_token_secret, twitter_refresh_token, 'legacy');
          results.twitter = [{ 
            success: true, 
            accountId: 'legacy',
            ...twitterResult 
          }];
          
          // Check if tokens were refreshed and store them for later update
          if (twitterResult?.refreshed && twitterResult?.newAccessToken) {
            console.log('Twitter tokens were refreshed, will update post with new tokens');
            tokenUpdates.twitter_access_token = twitterResult.newAccessToken;
          }
          
          console.log('Twitter posting completed successfully with legacy account');
        } catch (twitterError) {
          console.error('Error posting to Twitter with legacy account:', twitterError?.message);
          results.twitter = [{ 
            success: false, 
            accountId: 'legacy',
            error: twitterError?.message 
          }];
        }
      } else if (platform === 'twitter' && post.twitter_accounts && Array.isArray(post.twitter_accounts) && post.twitter_accounts.length > 0) {
        // Post to Twitter with multiple accounts
        console.log(`Found ${post.twitter_accounts.length} Twitter accounts to post to`);
        results.twitter = [];
        const twitterTokenUpdates = {};
        
        // Process each Twitter account
        for (const account of post.twitter_accounts) {
          try {
            const { accessToken, accessTokenSecret, refreshToken, userId, username } = account;
            
            if (!accessToken || !accessTokenSecret) {
              console.warn(`Skipping Twitter account ${userId || 'unknown'} due to missing tokens`);
              results.twitter.push({
                success: false,
                accountId: userId || 'unknown',
                error: 'Missing required tokens'
              });
              continue;
            }
            
            console.log(`Posting to Twitter account with ID ${userId || 'unknown'}`);
            console.log('Twitter account credentials check:', {
              hasAccessToken: !!accessToken,
              hasAccessTokenSecret: !!accessTokenSecret,
              hasRefreshToken: !!refreshToken,
              username: username || 'unknown'
            });
            
            // Wait 5 seconds between social media account posts to avoid rate limits
            if (results.twitter.length > 0) {
              console.log(`Waiting 5 seconds for next social media account post (Twitter account: ${userId || 'unknown'})`);
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
            
            const twitterResult = await postToTwitter(video_url, post_description, accessToken, accessTokenSecret, refreshToken, userId);
            
            results.twitter.push({
              success: true,
              accountId: userId || 'unknown',
              ...twitterResult
            });
            
            // Check if tokens were refreshed and store them for later update
            if (twitterResult?.refreshed && twitterResult?.newAccessToken) {
              console.log(`Twitter tokens were refreshed for account ${userId}, will update in post`);
              twitterTokenUpdates[userId] = {
                accessToken: twitterResult.newAccessToken
              };
            }
            
            console.log(`Twitter posting completed successfully for account ${userId || 'unknown'}`);
          } catch (accountError) {
            console.error(`Error posting to Twitter account ${account.userId || 'unknown'}:`, accountError?.message);
            results.twitter.push({
              success: false,
              accountId: account.userId || 'unknown',
              error: accountError?.message
            });
          }
        }
        
        // If we have token updates, we'll need to update the post
        if (Object.keys(twitterTokenUpdates).length > 0) {
          tokenUpdates.twitter_accounts = post.twitter_accounts.map(account => {
            const updates = twitterTokenUpdates[account.userId];
            if (updates) {
              return { ...account, ...updates };
            }
            return account;
          });
        }
      } else if (platform === 'twitter') {
        console.warn('Twitter credentials are missing');
        results.twitter = [{ success: false, accountId: 'unknown', error: 'Twitter credentials are missing' }];
      }
    } catch (error) {
      console.error(`Error processing platform ${platform}:`, error?.message);
      results[platform] = { success: false, error: error?.message };
    }
  }
  
  // Check if any platform was successful
  const anySuccess = Object.values(results).some(result => {
    if (Array.isArray(result)) {
      return result.some(r => r?.success);
    }
    return result?.success;
  });
  
  // Update tokens if they were refreshed
  if (Object.keys(tokenUpdates).length > 0 && post._id) {
    try {
      console.log('Updating post with refreshed tokens:', Object.keys(tokenUpdates).join(', '));
      await Post.updateOne({ _id: post._id }, tokenUpdates);
      console.log('Updated post with refreshed tokens successfully');
    } catch (updateError) {
      console.error('Error updating post with refreshed tokens:', updateError?.message);
      // Continue anyway, the post was still published
    }
  }
  
  if (!anySuccess) {
    throw new Error('Failed to post to any platform');
  }
  
  return results;
};

// Post to TikTok
const postToTikTok = async (videoUrl, caption, accessToken, refreshToken) => {
  try {
    const response = await axios.post(`${process.env.BACKEND_URL}/tiktok/post-video`, {
      videoUrl,
      caption,
      accessToken,
      refreshToken
    });
    
    return { success: true, data: response?.data };
  } catch (error) {
    console.error('Error posting to TikTok:', error?.message);
    throw new Error(`Failed to post to TikTok: ${error?.message}`);
  }
};

// Post to Twitter
const postToTwitter = async (videoUrl, text, accessToken, accessTokenSecret, twitter_refresh_token, userId) => {
  try {
    console.log('Posting to Twitter with credentials:', { 
      hasAccessToken: !!accessToken, 
      hasAccessTokenSecret: !!accessTokenSecret,
      hasRefreshToken: !!twitter_refresh_token,
      userId: userId || 'not provided'
    });
    
    try {
      const response = await axios.post(`${process.env.BACKEND_URL}/twitter/post-video`, {
        videoUrl,
        text,
        accessToken,
        accessTokenSecret,
        userId
      });
      
      console.log('Twitter API response:', response?.status, response?.statusText);
      return response?.data?.data || response?.data || {};
    } catch (error) {
      // If we get a 401 (Unauthorized) error and we have a refresh token, try to refresh the token
      if (error?.response?.status === 401 && twitter_refresh_token) {
        console.log('Twitter authentication failed, attempting to refresh token...');
        
        try {
          // Try to refresh the token
          const refreshResponse = await axios.post(`${process.env.BACKEND_URL}/twitter/refresh-token`, {
            refreshToken: twitter_refresh_token
          });
          
          if (refreshResponse?.data?.data?.access_token) {
            console.log('Twitter token refreshed successfully, retrying with new token');
            const newAccessToken = refreshResponse.data.data.access_token;
            
            // Retry with new token
            const retryResponse = await axios.post(`${process.env.BACKEND_URL}/twitter/post-video`, {
              videoUrl,
              text,
              accessToken: newAccessToken,
              accessTokenSecret,
              userId
            });
            
            console.log('Twitter API retry response:', retryResponse?.status, retryResponse?.statusText);
            
            // Return success with refreshed flag and new token
            return {
              ...(retryResponse?.data?.data || retryResponse?.data || {}),
              refreshed: true,
              newAccessToken
            };
          } else {
            throw new Error('Failed to refresh Twitter token');
          }
        } catch (refreshError) {
          console.error('Error refreshing Twitter token:', refreshError?.message);
          throw new Error(`Failed to refresh Twitter token: ${refreshError?.message || 'Unknown error'}`);
        }
      }
      
      // Handle other errors
      console.error('Error posting to Twitter:', error?.message);
      
      if (error.response) {
        console.error('Twitter API error response:', error.response?.status, error.response?.statusText);
        console.error('Twitter API error data:', error.response?.data);
      }
      
      throw new Error(`Failed to post to Twitter: ${error?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error posting to Twitter:', error?.message);
    
    if (error.response) {
      console.error('Twitter API error response:', error.response?.status, error.response?.statusText);
      console.error('Twitter API error data:', error.response?.data);
    }
    
    throw new Error(`Failed to post to Twitter: ${error?.message || 'Unknown error'}`);
  }
};

module.exports = {
  initScheduler,
  processPost  // Export processPost for testing
}; 