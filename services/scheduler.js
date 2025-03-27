const cron = require('node-cron');
const Post = require('../models/Post');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { hasReachedLimit } = require('../utils/roleLimits');
const userService = require('./userService');

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
                  openId: acc?.openId,
                  hasAccessToken: !!acc?.accessToken,
                  hasRefreshToken: !!acc?.refreshToken
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
      
      // Find users with Launch role and expired subscriptionEndDate
      const expiredUsers = await User.find({
        role: 'Launch',
        subscriptionEndDate: { $lt: now },
        'subscription.status': 'CANCELLED'
      });
      
      console.log(`Query criteria: role='Launch', subscriptionEndDate < ${now.toISOString()}, subscription.status='CANCELLED'`);
      
      if (expiredUsers.length > 0) {
        console.log(`Found ${expiredUsers.length} users with expired Launch subscriptions`);
        
        // Log all expired users for debugging
        expiredUsers.forEach(user => {
          console.log(`Expired subscription: User ${user.uid} (${user.email}), Role: ${user.role}, End date: ${user.subscriptionEndDate}, Current date: ${now.toISOString()}`);
        });
        
        // Downgrade each user
        for (const user of expiredUsers) {
          try {
            console.log(`Downgrading user ${user.uid} from Launch to Starter (subscription ended on ${user.subscriptionEndDate})`);
            
            await User.updateOne(
              { _id: user._id },
              { 
                role: 'Starter',
                $set: {
                  'subscription.status': 'EXPIRED'
                }
              }
            );
            
            console.log(`Successfully downgraded user ${user.uid} to Starter plan`);
          } catch (error) {
            console.error(`Error downgrading user ${user.uid}:`, error?.message);
          }
        }
      } else {
        console.log('No users with expired Launch subscriptions found');
        
        // For debugging, find all Launch users with CANCELLED status
        const allCancelledLaunchUsers = await User.find({
          role: 'Launch',
          'subscription.status': 'CANCELLED'
        });
        
        console.log(`Found ${allCancelledLaunchUsers.length} Launch users with CANCELLED status`);
        
        allCancelledLaunchUsers.forEach(user => {
          const endDate = user.subscriptionEndDate;
          const isExpired = endDate && endDate < now;
          console.log(`Cancelled Launch user: ${user.uid} (${user.email}), End date: ${endDate}, Current date: ${now.toISOString()}, Is expired: ${isExpired}`);
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
    twitter_refresh_token,
    twitter_accounts
  } = post;
  
  if (!video_url || !platforms || platforms.length === 0) {
    throw new Error('Invalid post data');
  }
  
  if (!userId) {
    throw new Error('User ID is required for post processing');
  }
  
  console.log('Post data for processing:', {
    video_url: !!video_url,
    post_description: !!post_description,
    platforms,
    has_tiktok_accounts: !!tiktok_accounts,
    tiktok_accounts_count: tiktok_accounts?.length || 0,
    has_legacy_tiktok: !!tiktok_access_token,
    has_twitter: !!twitter_access_token && !!twitter_access_token_secret,
    has_twitter_refresh: !!twitter_refresh_token,
    has_twitter_accounts: !!twitter_accounts && Array.isArray(twitter_accounts) && twitter_accounts.length > 0,
  });
  
  // Check if we need to retrieve tokens from the database
  let updatedTiktokAccounts = tiktok_accounts;
  let updatedTwitterAccounts = twitter_accounts;
  
  // Fetch TikTok tokens from database if not provided in post
  if (platforms.includes('tiktok') && (!tiktok_accounts || tiktok_accounts.length === 0) && !tiktok_access_token) {
    console.log(`No TikTok tokens in post, retrieving from database for user ${userId}`);
    try {
      const tiktokTokens = await userService.getSocialMediaTokens(userId, 'tiktok');
      if (tiktokTokens && Array.isArray(tiktokTokens) && tiktokTokens.length > 0) {
        console.log(`Found ${tiktokTokens.length} TikTok accounts in database for user ${userId}`);
        updatedTiktokAccounts = tiktokTokens;
      } else {
        console.warn(`No TikTok tokens found in database for user ${userId}`);
      }
    } catch (error) {
      console.error(`Error retrieving TikTok tokens from database:`, error?.message);
    }
  }
  
  // Fetch Twitter tokens from database if not provided in post
  if (platforms.includes('twitter') && (!twitter_accounts || twitter_accounts.length === 0) && 
      (!twitter_access_token || !twitter_access_token_secret)) {
    console.log(`No Twitter tokens in post, retrieving from database for user ${userId}`);
    try {
      const twitterTokens = await userService.getSocialMediaTokens(userId, 'twitter');
      if (twitterTokens && Array.isArray(twitterTokens) && twitterTokens.length > 0) {
        console.log(`Found ${twitterTokens.length} Twitter accounts in database for user ${userId}`);
        updatedTwitterAccounts = twitterTokens;
      } else {
        console.warn(`No Twitter tokens found in database for user ${userId}`);
      }
    } catch (error) {
      console.error(`Error retrieving Twitter tokens from database:`, error?.message);
    }
  }
  
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
        if (updatedTiktokAccounts && updatedTiktokAccounts.length > 0) {
          console.log(`Found ${updatedTiktokAccounts.length} TikTok accounts to post to`);
          
          const accountResults = [];
          
          for (let i = 0; i < updatedTiktokAccounts.length; i++) {
            const account = updatedTiktokAccounts[i];
            console.log(`TikTok account ${i + 1}:`, {
              openId: account?.openId,
              hasAccessToken: !!account?.accessToken,
              hasRefreshToken: !!account?.refreshToken
            });
            
            try {
              console.log(`Posting to TikTok account with ID ${account?.openId}`);
              const accountResult = await postToTikTok(
                video_url, 
                post_description, 
                account?.accessToken, 
                account?.refreshToken
              );
              
              accountResults.push({ 
                success: true, 
                accountId: account?.openId,
                ...accountResult 
              });
              
              console.log(`TikTok posting completed successfully for account ${account?.openId}`);
              
              // Add a 5-second delay between accounts if not the last account
              if (i < updatedTiktokAccounts.length - 1) {
                console.log(`Waiting 5 seconds for next social media account post (TikTok account: ${updatedTiktokAccounts[i+1]?.openId})`);
                await new Promise(resolve => setTimeout(resolve, 5000));
              }
            } catch (accountError) {
              console.error(`Error posting to TikTok account ${account?.openId}:`, accountError?.message);
              accountResults.push({ 
                success: false, 
                accountId: account?.openId,
                error: accountError?.message 
              });
              
              // Still add delay even if posting failed
              if (i < updatedTiktokAccounts.length - 1) {
                console.log(`Waiting 5 seconds for next social media account post (TikTok account: ${updatedTiktokAccounts[i+1]?.openId})`);
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
      else if (platform === 'twitter' && updatedTwitterAccounts && updatedTwitterAccounts.length > 0) {
        // Post to Twitter with multiple accounts
        console.log(`Found ${updatedTwitterAccounts.length} Twitter accounts to post to`);
        results.twitter = [];
        const twitterTokenUpdates = {};
        
        // Process each Twitter account
        for (const account of updatedTwitterAccounts) {
          try {
            const { accessToken, accessTokenSecret, refreshToken, userId, username } = account || {};
            
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
            
            const twitterResult = await postToTwitter(video_url, post_description, accessToken, accessTokenSecret, userId);
            
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
          tokenUpdates.twitter_accounts = updatedTwitterAccounts.map(account => {
            const updates = twitterTokenUpdates[account.userId];
            if (updates) {
              return { ...account, ...updates };
            }
            return account;
          });
        }
      } else if (platform === 'twitter' && twitter_access_token && twitter_access_token_secret) {
        // Post to Twitter using legacy single account format (for backward compatibility)
        try {
          console.log('Posting to Twitter with legacy credentials:', { 
            hasAccessToken: !!twitter_access_token, 
            hasAccessTokenSecret: !!twitter_access_token_secret,
            hasRefreshToken: !!twitter_refresh_token
          });
          
          const twitterResult = await postToTwitter(video_url, post_description, twitter_access_token, twitter_access_token_secret, 'legacy');
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
const postToTwitter = async (videoUrl, text, accessToken, accessTokenSecret, userId) => {
  try {
    console.log('Posting to Twitter with credentials:', { 
      hasAccessToken: !!accessToken, 
      hasAccessTokenSecret: !!accessTokenSecret,
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
      // Handle errors
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

// Check if a user has reached their limits for posts
const checkUserLimits = async (userId, postType) => {
  try {
    if (!userId) {
      return {
        allowed: false,
        message: 'User ID is required'
      };
    }
    
    // Find the user
    const user = await User.findOne({ uid: userId });
    if (!user) {
      return {
        allowed: false,
        message: 'User not found'
      };
    }
    
    const userRole = user.role || 'Starter';
    
    // Handle scheduled posts
    if (postType === 'scheduled') {
      // Count existing scheduled posts
      const scheduledPostsCount = await Post.countDocuments({
        userId,
        isScheduled: true,
        status: 'pending'
      });
      
      // Check if user has reached their limit
      if (hasReachedLimit(userRole, 'scheduledPosts', scheduledPostsCount)) {
        const limit = userRole === 'Starter' ? 5 : 
                     userRole === 'Launch' ? 30 :
                     'unlimited';
        
        return {
          allowed: false,
          message: `You have reached the maximum of ${limit} scheduled posts for your ${userRole} plan`,
          limit,
          current: scheduledPostsCount
        };
      }
    }
    
    // If no limits were reached or not checking limits
    return {
      allowed: true
    };
  } catch (error) {
    console.error('Error checking user limits:', error?.message);
    // Default to allowing post if there's an error checking
    return {
      allowed: true,
      warning: 'Unable to verify limits'
    };
  }
};

// Update the checkScheduledPosts function
const checkScheduledPosts = async () => {
  try {
    const now = new Date();
    console.log(`Running scheduler check at ${now.toISOString()}`);
    
    // Find posts that are scheduled and ready to be posted
    const posts = await Post.find({
      isScheduled: true,
      status: 'pending',
      scheduledDate: { $lte: now }
    });
    
    console.log(`Found ${posts.length} scheduled posts ready to be posted`);
    
    // Process each post
    for (const post of posts) {
      console.log(`Processing scheduled post: ${post._id}, scheduled for ${post.scheduledDate}`);
      
      // Before processing, check if the user still has valid subscription
      const user = await User.findOne({ uid: post.userId });
      if (!user) {
        console.error(`User not found for post ${post._id}`);
        continue;
      }
      
      // Process the post
      await processPost(post);
    }
  } catch (error) {
    console.error('Error in scheduler:', error);
  }
};

module.exports = {
  initScheduler,
  processPost,
  checkUserLimits,
  checkScheduledPosts
}; 