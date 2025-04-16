const express = require('express');
const router = express.Router();
const User = require('../models/User');
const paypalService = require('../services/paypalService');

// Add CORS headers for subscription requests
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.header('origin') || process.env.FRONTEND_URL || 'https://sociallane-frontend.mindio.chat');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Create a subscription
router.post('/create-subscription', async (req, res) => {
  try {
    const { uid, planTier = 'Launch' } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Validate the plan tier
    if (!['Launch', 'Rise', 'Scale'].includes(planTier)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid plan tier. Must be Launch, Rise, or Scale'
      });
    }

    console.log(`Creating subscription for user ${uid} with plan tier: ${planTier}`);

    // Find the user
    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // If user has a subscription that's not active, check with PayPal for its status
    if (user.subscription?.paypalSubscriptionId) {
      console.log(`User ${uid} has an existing subscription: ${user.subscription.paypalSubscriptionId}. Checking status with PayPal.`);
      try {
        const subscriptionDetails = await paypalService.getSubscription(user.subscription.paypalSubscriptionId);
        
        // If the subscription is still active in PayPal but not in our DB, update our DB
        if (subscriptionDetails.status === 'ACTIVE') {
          console.log(`Subscription ${user.subscription.paypalSubscriptionId} is active in PayPal but not in our DB. Updating DB.`);
          
          // Get the plan tier from the plan ID
          const currentPlanTier = paypalService.getPlanTierFromId(subscriptionDetails.plan_id);
          
          await User.findOneAndUpdate(
            { uid },
            {
              role: currentPlanTier,
              'subscription.status': 'ACTIVE',
              'subscription.updatedAt': new Date(),
              'subscription.planId': subscriptionDetails.plan_id
            }
          );
          
          return res.status(400).json({
            success: false,
            error: 'User already has an active subscription in PayPal'
          });
        }
      } catch (error) {
        // If we can't get the subscription from PayPal, it might be deleted or invalid
        console.log(`Failed to get subscription details from PayPal: ${error.message}. Proceeding with new subscription.`);
      }
    }

    // Create subscription with PayPal
    const subscription = await paypalService.createSubscription({
      returnUrl: `${process.env.BACKEND_URL}/paypal/subscription-success?uid=${uid}&plan_tier=${planTier}`,
      cancelUrl: `${process.env.FRONTEND_URL}/subscription?status=cancelled&uid=${uid}`,
      planTier: planTier
    });

    console.log(`Created PayPal subscription: ${subscription.id} for user: ${uid} with plan tier: ${planTier}`);

    // Update user with pending subscription
    await User.findOneAndUpdate(
      { uid },
      {
        'subscription.paypalSubscriptionId': subscription.id,
        'subscription.status': 'APPROVAL_PENDING',
        'subscription.planId': subscription.plan_id,
        'subscription.createdAt': new Date(),
        'subscription.updatedAt': new Date()
      }
    );

    // Return the subscription approval URL
    res.status(200).json({
      success: true,
      data: {
        approvalUrl: subscription.links.find(link => link.rel === 'approve').href
      }
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error creating subscription'
    });
  }
});

// Handle subscription success (redirect from PayPal)
router.get('/subscription-success', async (req, res) => {
  try {
    const { uid, subscription_id, plan_tier = 'Launch' } = req.query;
    console.log(`Handling subscription success for user: ${uid}, subscription: ${subscription_id}, plan tier: ${plan_tier}`);
    
    if (!uid || !subscription_id) {
      console.log('User ID and subscription ID are required but were not provided');
      return res.status(400).json({
        success: false,
        error: 'User ID and subscription ID are required'
      });
    }

    // Get subscription details from PayPal
    const subscriptionDetails = await paypalService.getSubscription(subscription_id);
    console.log(`Subscription status from PayPal: ${subscriptionDetails.status}`);
    
    // Determine the correct role based on the plan ID
    const planTier = paypalService.getPlanTierFromId(subscriptionDetails.plan_id);
    console.log(`Determined plan tier from PayPal plan ID: ${planTier}`);
    
    // Update user with active subscription
    const user = await User.findOneAndUpdate(
      { uid },
      {
        role: planTier,
        subscriptionStartDate: new Date(),
        'subscription.paypalSubscriptionId': subscription_id,
        'subscription.status': subscriptionDetails.status,
        'subscription.planId': subscriptionDetails.plan_id,
        'subscription.updatedAt': new Date(),
        'subscription.nextBillingTime': new Date(subscriptionDetails.billing_info?.next_billing_time || Date.now()),
        $push: {
          paymentHistory: {
            amount: subscriptionDetails.billing_info?.last_payment?.amount?.value || 0,
            currency: subscriptionDetails.billing_info?.last_payment?.amount?.currency_code || 'USD',
            paymentMethod: 'PayPal',
            transactionId: subscription_id
          }
        }
      },
      { new: true }
    );

    if (!user) {
      console.log(`User not found with ID: ${uid}`);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    console.log(`Updated user ${uid} with active subscription: ${subscription_id}, role: ${planTier}`);

    // Redirect to frontend with success status
    res.redirect(`${process.env.FRONTEND_URL}/my-account?subscription=success&uid=${uid}`);
  } catch (error) {
    console.error('Error handling subscription success:', error);
    res.redirect(`${process.env.FRONTEND_URL}/subscription?status=error&uid=${req.query.uid}`);
  }
});

// Get subscription details
router.get('/:uid/subscription', async (req, res) => {
  try {
    const { uid } = req.params;
    console.log(`Getting subscription details for user: ${uid}`);
    
    // Find the user
    const user = await User.findOne({ uid });
    if (!user) {
      console.log(`User not found with ID: ${uid}`);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // If user has no subscription
    if (!user.subscription?.paypalSubscriptionId) {
      console.log(`User ${uid} has no subscription`);
      return res.status(200).json({
        success: true,
        data: {
          hasSubscription: false,
          role: user.role
        }
      });
    }

    // Check if subscription has expired but user still has a paid role
    const now = new Date();
    if (['Launch', 'Rise', 'Scale'].includes(user.role) && 
        user.subscription.status === 'CANCELLED' && 
        user.subscriptionEndDate && 
        user.subscriptionEndDate < now) {
      
      console.log(`User ${uid} has expired subscription (end date: ${user.subscriptionEndDate.toISOString()}) but still has ${user.role} role. Downgrading to Starter.`);
      
      // Update user to Starter role
      await User.findOneAndUpdate(
        { uid },
        {
          role: 'Starter',
          'subscription.status': 'EXPIRED'
        }
      );
      
      // Reload user with updated data
      const updatedUser = await User.findOne({ uid });
      
      return res.status(200).json({
        success: true,
        data: {
          hasSubscription: true,
          subscriptionId: updatedUser.subscription.paypalSubscriptionId,
          status: 'EXPIRED',
          role: 'Starter',
          planId: updatedUser.subscription.planId,
          planTier: 'Starter',
          subscriptionEndDate: updatedUser.subscriptionEndDate
        }
      });
    }

    // Get subscription details from PayPal if it exists
    try {
      console.log(`Fetching subscription details from PayPal for: ${user.subscription.paypalSubscriptionId}`);
      const subscriptionDetails = await paypalService.getSubscription(user.subscription.paypalSubscriptionId);
      
      // Determine the plan tier based on the plan ID
      const planTier = paypalService.getPlanTierFromId(subscriptionDetails.plan_id);
      
      // Update subscription status if it has changed
      if (subscriptionDetails.status !== user.subscription.status) {
        console.log(`Subscription status changed from ${user.subscription.status} to ${subscriptionDetails.status}. Updating user.`);
        
        await User.findOneAndUpdate(
          { uid },
          {
            'subscription.status': subscriptionDetails.status,
            'subscription.updatedAt': new Date(),
            'subscription.nextBillingTime': new Date(subscriptionDetails.billing_info?.next_billing_time || Date.now()),
            // Update role if subscription is no longer active
            ...(subscriptionDetails.status !== 'ACTIVE' && { role: 'Starter' })
          }
        );
      }

      console.log(`Returning subscription details for user ${uid}, subscriptionEndDate: ${user.subscriptionEndDate ? user.subscriptionEndDate.toISOString() : 'undefined'}`);
      res.status(200).json({
        success: true,
        data: {
          hasSubscription: true,
          subscriptionId: user.subscription.paypalSubscriptionId,
          status: subscriptionDetails.status,
          nextBillingTime: subscriptionDetails.billing_info?.next_billing_time,
          role: subscriptionDetails.status === 'ACTIVE' ? planTier : 'Starter',
          planId: subscriptionDetails.plan_id,
          planTier: planTier,
          subscriptionEndDate: user.subscriptionEndDate
        }
      });
    } catch (error) {
      // If we can't get subscription details, return what we have
      console.error('Error getting subscription details from PayPal:', error);
      console.log(`Returning local subscription details for user ${uid}, subscriptionEndDate: ${user.subscriptionEndDate ? user.subscriptionEndDate.toISOString() : 'undefined'}`);
      res.status(200).json({
        success: true,
        data: {
          hasSubscription: true,
          subscriptionId: user.subscription.paypalSubscriptionId,
          status: user.subscription.status,
          nextBillingTime: user.subscription.nextBillingTime,
          role: user.role,
          planId: user.subscription.planId,
          planTier: paypalService.getPlanTierFromId(user.subscription.planId) || user.role,
          subscriptionEndDate: user.subscriptionEndDate
        }
      });
    }
  } catch (error) {
    console.error('Error getting subscription details:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error getting subscription details'
    });
  }
});

// Endpoint for the user to manually cancel their subscription
router.post('/:uid/cancel-subscription', async (req, res) => {
  try {
    const { uid } = req.params;
    const user = await User.findOne({ uid });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const paypalSubscriptionId = user?.subscription?.paypalSubscriptionId;
    
    if (!paypalSubscriptionId) {
      return res.status(400).json({
        success: false,
        error: 'No active subscription found for this user'
      });
    }

    console.log(`Processing manual subscription cancellation for user ${uid} with subscription ${paypalSubscriptionId}`);

    try {
      // Call PayPal to cancel the subscription
      const response = await fetch(
        `${process.env.PAYPAL_API_URL}/v1/billing/subscriptions/${paypalSubscriptionId}/cancel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${await paypalService.getAccessToken()}`
          },
          body: JSON.stringify({
            reason: 'Cancelled by user'
          })
        }
      );

      // Get subscription details to determine end date
      const subscriptionDetails = await fetch(
        `${process.env.PAYPAL_API_URL}/v1/billing/subscriptions/${paypalSubscriptionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${await paypalService.getAccessToken()}`
          }
        }
      ).then(res => res.json());

      let subscriptionEndDate = null;
      
      // Use next billing time if available
      if (subscriptionDetails?.billing_info?.next_billing_time) {
        subscriptionEndDate = new Date(subscriptionDetails.billing_info.next_billing_time);
        console.log(`Using next billing time for end date: ${subscriptionEndDate}`);
      } else if (user?.subscriptionEndDate) {
        subscriptionEndDate = new Date(user.subscriptionEndDate);
        console.log(`Using existing end date: ${subscriptionEndDate}`);
      } else {
        // Default to 30 days from now
        subscriptionEndDate = new Date();
        subscriptionEndDate.setDate(subscriptionEndDate.getDate() + 30);
        console.log(`Using default end date (30 days from now): ${subscriptionEndDate}`);
      }

      // Update user record with cancellation status
      await User.updateOne(
        { uid },
        {
          'subscription.status': 'CANCELLED',
          'subscription.updatedAt': new Date(),
          subscriptionEndDate
        }
      );

      console.log(`Updated user ${user?.email || user?.uid} subscription status to CANCELLED - will expire on ${subscriptionEndDate}`);

      return res.status(200).json({
        success: true,
        message: 'Subscription cancelled successfully',
        subscriptionEndDate
      });
    } catch (paypalError) {
      console.error('Error cancelling subscription with PayPal:', paypalError);
      
      // Even if PayPal request fails, try to mark as cancelled in our DB
      try {
        // Set a default end date
        const subscriptionEndDate = new Date();
        subscriptionEndDate.setDate(subscriptionEndDate.getDate() + 30);
        
        await User.updateOne(
          { uid },
          {
            'subscription.status': 'CANCELLED',
            'subscription.updatedAt': new Date(),
            subscriptionEndDate
          }
        );
        
        console.log(`Failed with PayPal but updated local subscription status to CANCELLED for user ${uid}`);
        
        return res.status(200).json({
          success: true,
          message: 'Subscription marked as cancelled in our system, but there was an issue with the payment provider',
          subscriptionEndDate
        });
      } catch (dbError) {
        console.error('Error updating user subscription status:', dbError);
        return res.status(500).json({
          success: false,
          error: 'Failed to cancel subscription. Please contact support.'
        });
      }
    }
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'An unexpected error occurred'
    });
  }
});

// Handle PayPal webhooks
router.post('/webhook', async (req, res) => {
  try {
    console.log('Received PayPal webhook');
    // Get the raw body from the middleware
    const rawBody = req.rawBody;
    
    if (!rawBody) {
      console.error('No raw body found in request');
      return res.status(400).json({ success: false, error: 'No raw body found in request' });
    }

    // Verify webhook signature
    const isVerified = await paypalService.verifyWebhookSignature(
      req.headers,
      rawBody
    );

    if (!isVerified) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ success: false, error: 'Invalid webhook signature' });
    }

    const event = JSON.parse(rawBody);
    const eventType = event.event_type;
    const resource = event.resource;

    console.log(`Processing PayPal webhook event: ${eventType}`);

    // Handle different webhook events
    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.CREATED':
        // Subscription created - nothing to do here as we already handle this in the success route
        console.log('Subscription created webhook received');
        break;

      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        // Subscription activated
        console.log('Subscription activated webhook received');
        await handleSubscriptionActivated(resource);
        break;

      case 'BILLING.SUBSCRIPTION.UPDATED':
        // Subscription updated
        console.log('Subscription updated webhook received');
        await handleSubscriptionUpdated(resource);
        break;

      case 'BILLING.SUBSCRIPTION.CANCELLED':
        // Subscription cancelled
        console.log('Subscription cancelled webhook received');
        await handleSubscriptionCancelled(resource);
        break;

      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        // Subscription suspended
        console.log('Subscription suspended webhook received');
        await handleSubscriptionSuspended(resource);
        break;

      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
        // Payment failed
        console.log('Subscription payment failed webhook received');
        await handlePaymentFailed(resource);
        break;

      case 'PAYMENT.SALE.COMPLETED':
        // Payment completed
        console.log('Payment completed webhook received');
        await handlePaymentCompleted(resource);
        break;

      default:
        console.log(`Unhandled webhook event type: ${eventType}`);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ success: false, error: 'Error handling webhook' });
  }
});

// Helper functions for webhook handlers
async function handleSubscriptionActivated(resource) {
  try {
    const subscriptionId = resource.id;
    console.log(`Processing subscription activated webhook for: ${subscriptionId}`);
    
    // Find user with this subscription ID
    const user = await User.findOne({ 'subscription.paypalSubscriptionId': subscriptionId });
    if (!user) {
      console.error(`User not found for subscription: ${subscriptionId}`);
      return;
    }

    console.log(`Updating user ${user.uid} with activated subscription`);

    // Determine the plan tier from the plan ID
    const planTier = paypalService.getPlanTierFromId(resource.plan_id);
    
    // Update user subscription status
    await User.findOneAndUpdate(
      { 'subscription.paypalSubscriptionId': subscriptionId },
      {
        role: planTier,
        'subscription.status': 'ACTIVE',
        'subscription.planId': resource.plan_id,
        'subscription.updatedAt': new Date(),
        'subscription.nextBillingTime': new Date(resource.billing_info?.next_billing_time || Date.now()),
        subscriptionStartDate: new Date()
      }
    );
    
    console.log(`Successfully updated user ${user.uid} with activated subscription, role: ${planTier}`);
  } catch (error) {
    console.error('Error handling subscription activated webhook:', error);
  }
}

async function handleSubscriptionUpdated(resource) {
  try {
    const subscriptionId = resource.id;
    console.log(`Processing subscription updated webhook for: ${subscriptionId}`);
    
    // Find user with this subscription ID
    const user = await User.findOne({ 'subscription.paypalSubscriptionId': subscriptionId });
    if (!user) {
      console.error(`User not found for subscription: ${subscriptionId}`);
      return;
    }

    console.log(`Updating user ${user.uid} with updated subscription status: ${resource.status}`);

    // Get the next billing time
    const nextBillingTime = resource.billing_info?.next_billing_time;
    
    // For cancelled subscriptions, we need to check if they still have access
    // If the subscription is cancelled but next_billing_time is in the future, they still have paid access
    const isCancelledButActive = 
      resource.status === 'CANCELLED' && 
      nextBillingTime && 
      new Date(nextBillingTime) > new Date();
    
    // Ensure we have a valid end date for cancelled subscriptions
    let endDate;
    if (resource.status === 'CANCELLED') {
      if (nextBillingTime) {
        endDate = new Date(nextBillingTime);
      } else {
        // If no next billing time is available, set end date to 30 days from now as fallback
        endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        console.log(`No next billing time available for cancelled subscription, using fallback end date: ${endDate.toISOString()}`);
      }
    } else if (nextBillingTime) {
      endDate = new Date(nextBillingTime);
    }
    
    // Determine the plan tier from the plan ID
    const planTier = paypalService.getPlanTierFromId(resource.plan_id);
    
    // Update user subscription status
    const updateData = {
      'subscription.status': resource.status,
      'subscription.updatedAt': new Date(),
      'subscription.planId': resource.plan_id
    };
    
    // Add next billing time if available
    if (endDate) {
      updateData['subscription.nextBillingTime'] = endDate;
    }
    
    // Only update role to Starter if subscription is no longer active and not in the "cancelled but active" state
    if (!isCancelledButActive && resource.status !== 'ACTIVE') {
      updateData.role = 'Starter';
    } else if (resource.status === 'ACTIVE') {
      // If active, set to the appropriate plan tier
      updateData.role = planTier;
    }
    
    await User.findOneAndUpdate(
      { 'subscription.paypalSubscriptionId': subscriptionId },
      updateData
    );
    
    console.log(`Successfully updated user ${user.uid} with status: ${resource.status}, role: ${updateData.role || user.role}`);
  } catch (error) {
    console.error('Error handling subscription updated webhook:', error);
  }
}

const handleSubscriptionCancelled = async (resource) => {
  try {
    const subscriptionId = resource?.id;
    if (!subscriptionId) {
      console.error('Missing subscription ID in PayPal cancellation webhook');
      return {
        success: false,
        error: 'Missing subscription ID'
      };
    }

    console.log(`Processing subscription cancellation for ID: ${subscriptionId}`);

    // Find the user with this subscription ID
    const user = await User.findOne({
      'subscription.paypalSubscriptionId': subscriptionId
    });

    if (!user) {
      console.error(`No user found with PayPal subscription ID: ${subscriptionId}`);
      return {
        success: false,
        error: 'User not found'
      };
    }

    // We'll keep the user on their current plan until the end of the billing period
    // Get the next billing date from the resource details if available
    let subscriptionEndDate = null;
    
    // First try to get from nextBillingTime if available
    if (resource?.billing_info?.next_billing_time) {
      subscriptionEndDate = new Date(resource.billing_info.next_billing_time);
      console.log(`Using next billing time for end date: ${subscriptionEndDate}`);
    } 
    // Fallback to user's existing end date or +30 days
    else if (user?.subscriptionEndDate) {
      subscriptionEndDate = new Date(user.subscriptionEndDate);
      console.log(`Using existing end date: ${subscriptionEndDate}`);
    } else {
      // Default to 30 days from now
      subscriptionEndDate = new Date();
      subscriptionEndDate.setDate(subscriptionEndDate.getDate() + 30);
      console.log(`Using default end date (30 days from now): ${subscriptionEndDate}`);
    }

    // Update the user's subscription status
    await User.updateOne(
      { _id: user._id },
      {
        'subscription.status': 'CANCELLED',
        'subscription.updatedAt': new Date(),
        subscriptionEndDate: subscriptionEndDate
      }
    );

    console.log(`Updated user ${user?.email || user?.uid} subscription status to CANCELLED - will expire on ${subscriptionEndDate}`);
    
    return {
      success: true,
      user: user?.uid,
      message: 'Subscription marked as CANCELLED'
    };
  } catch (error) {
    console.error('Error handling subscription cancellation:', error);
    return {
      success: false,
      error: error?.message || 'Error processing cancellation'
    };
  }
};

async function handleSubscriptionSuspended(resource) {
  try {
    const subscriptionId = resource.id;
    console.log(`Processing subscription suspended webhook for: ${subscriptionId}`);
    
    // Find user with this subscription ID
    const user = await User.findOne({ 'subscription.paypalSubscriptionId': subscriptionId });
    if (!user) {
      console.error(`User not found for subscription: ${subscriptionId}`);
      return;
    }

    console.log(`Updating user ${user.uid} with suspended subscription`);

    // Update user subscription status
    await User.findOneAndUpdate(
      { 'subscription.paypalSubscriptionId': subscriptionId },
      {
        role: 'Starter',
        'subscription.status': 'SUSPENDED',
        'subscription.updatedAt': new Date()
      }
    );
    
    console.log(`Successfully updated user ${user.uid} with suspended subscription, role changed to Starter`);
  } catch (error) {
    console.error('Error handling subscription suspended webhook:', error);
  }
}

async function handlePaymentFailed(resource) {
  try {
    const subscriptionId = resource.id;
    console.log(`Processing payment failed webhook for subscription: ${subscriptionId}`);
    
    // Find user with this subscription ID
    const user = await User.findOne({ 'subscription.paypalSubscriptionId': subscriptionId });
    if (!user) {
      console.error(`User not found for subscription: ${subscriptionId}`);
      return;
    }

    console.log(`Updating user ${user.uid} with failed payment`);

    // Update user subscription status and increment failed payments
    await User.findOneAndUpdate(
      { 'subscription.paypalSubscriptionId': subscriptionId },
      {
        $inc: { 'subscription.failedPayments': 1 },
        'subscription.updatedAt': new Date()
      }
    );
    
    console.log(`Successfully updated user ${user.uid} with failed payment`);
  } catch (error) {
    console.error('Error handling payment failed webhook:', error);
  }
}

async function handlePaymentCompleted(resource) {
  try {
    // The resource might contain the subscription ID in a different location
    // depending on the payment type
    const subscriptionId = resource.billing_agreement_id;
    
    if (!subscriptionId) {
      console.error('Subscription ID not found in payment resource');
      return;
    }

    console.log(`Processing payment completed webhook for subscription: ${subscriptionId}`);

    // Find user with this subscription ID
    const user = await User.findOne({ 'subscription.paypalSubscriptionId': subscriptionId });
    if (!user) {
      console.error(`User not found for subscription: ${subscriptionId}`);
      return;
    }

    console.log(`Updating user ${user.uid} with completed payment`);

    // Add payment to history
    await User.findOneAndUpdate(
      { 'subscription.paypalSubscriptionId': subscriptionId },
      {
        $push: {
          paymentHistory: {
            amount: resource.amount?.total || 0,
            currency: resource.amount?.currency || 'USD',
            paymentMethod: 'PayPal',
            transactionId: resource.id
          }
        },
        'subscription.failedPayments': 0, // Reset failed payments counter
        'subscription.updatedAt': new Date()
      }
    );
    
    console.log(`Successfully updated user ${user.uid} with completed payment`);
  } catch (error) {
    console.error('Error handling payment completed webhook:', error);
  }
}

// Check and update expired subscriptions
const checkExpiredSubscriptions = async () => {
  try {
    console.log('Manual subscription expiration check running...');
    
    // Find users with roles Launch, Rise, or Scale whose subscription end date is past
    // and whose subscription status is CANCELLED
    const expiredUsers = await User.find({
      role: { $in: ['Launch', 'Rise', 'Scale'] },
      subscriptionEndDate: { $lt: new Date() },
      'subscription.status': 'CANCELLED'
    });
    
    console.log(`Found ${expiredUsers?.length || 0} users with expired subscriptions.`);
    
    if (expiredUsers?.length > 0) {
      for (const user of expiredUsers) {
        console.log(`Downgrading user ${user.email} from ${user.role} to Starter - subscription expired on ${user.subscriptionEndDate}`);
        
        // Store subscription history for reference before clearing
        const subscriptionHistory = {
          previousRole: user.role,
          subscriptionId: user.subscription?.paypalSubscriptionId,
          status: user.subscription?.status,
          endDate: user.subscriptionEndDate,
          expiredAt: new Date()
        };
        
        try {
          // Add to payment history for record keeping
          await User.updateOne(
            { _id: user._id },
            {
              $push: {
                paymentHistory: {
                  amount: 0,
                  currency: 'USD',
                  date: new Date(),
                  paymentMethod: 'System',
                  transactionId: 'subscription-expired',
                  metadata: subscriptionHistory
                }
              }
            }
          );
          
          // Completely reset subscription data
          await User.updateOne(
            { _id: user._id },
            { 
              role: 'Starter',
              $unset: {
                subscriptionStartDate: 1,
                subscriptionEndDate: 1,
                'subscription.paypalSubscriptionId': 1,
                'subscription.planId': 1,
                'subscription.nextBillingTime': 1
              },
              $set: {
                'subscription.status': 'EXPIRED',
                'subscription.updatedAt': new Date()
              }
            }
          );
          console.log(`Successfully reset subscription data for expired user ${user.email}`);
        } catch (updateError) {
          console.error(`Error updating user ${user.email} during expiration:`, updateError);
        }
      }
    } else {
      // Just for debugging
      const cancelledSubscriptionUsers = await User.countDocuments({
        'subscription.status': 'CANCELLED'
      });
      console.log(`Found ${cancelledSubscriptionUsers} users with CANCELLED subscriptions (not expired yet).`);
    }
    
    return {
      success: true,
      expiredSubscriptions: expiredUsers?.length || 0
    };
  } catch (error) {
    console.error('Error checking expired subscriptions:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Add an endpoint to manually trigger subscription expiration check
router.post('/check-expired-subscriptions', async (req, res) => {
  try {
    const result = await checkExpiredSubscriptions();
    res.status(200).json(result);
  } catch (error) {
    console.error('Error checking expired subscriptions:', error);
    res.status(500).json({ success: false, error: error?.message });
  }
});

// Select a subscription plan
router.post('/select-plan', async (req, res) => {
  try {
    const { uid, planTier } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    if (!planTier || !['Launch', 'Rise', 'Scale'].includes(planTier)) {
      return res.status(400).json({
        success: false,
        error: 'Valid plan tier is required (Launch, Rise, or Scale)'
      });
    }

    console.log(`User ${uid} selected ${planTier} plan`);

    // Find the user
    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Create subscription with PayPal
    const subscription = await paypalService.createSubscription({
      returnUrl: `${process.env.BACKEND_URL}/paypal/subscription-success?uid=${uid}&plan_tier=${planTier}`,
      cancelUrl: `${process.env.FRONTEND_URL}/subscription?status=cancelled&uid=${uid}`,
      planTier: planTier
    });

    console.log(`Created PayPal subscription: ${subscription.id} for user: ${uid} with plan tier: ${planTier}`);

    // Update user with pending subscription
    await User.findOneAndUpdate(
      { uid },
      {
        'subscription.paypalSubscriptionId': subscription.id,
        'subscription.status': 'APPROVAL_PENDING',
        'subscription.planId': subscription.plan_id,
        'subscription.createdAt': new Date(),
        'subscription.updatedAt': new Date()
      }
    );

    // Return the subscription approval URL
    res.status(200).json({
      success: true,
      data: {
        approvalUrl: subscription.links.find(link => link.rel === 'approve').href,
        planTier: planTier
      }
    });
  } catch (error) {
    console.error('Error selecting plan:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error selecting plan'
    });
  }
});

// Add an endpoint to manually reset a user's subscription data immediately
router.post('/:uid/reset-subscription', async (req, res) => {
  try {
    const { uid } = req.params;
    console.log(`Manual reset subscription request for user ${uid}`);
    
    // Find the user first
    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Store subscription history for reference before clearing
    const subscriptionHistory = {
      previousRole: user.role,
      subscriptionId: user.subscription?.paypalSubscriptionId,
      status: user.subscription?.status || 'UNKNOWN',
      endDate: user.subscriptionEndDate,
      resetAt: new Date()
    };
    
    // Add to payment history for record keeping
    await User.updateOne(
      { uid },
      {
        $push: {
          paymentHistory: {
            amount: 0,
            currency: 'USD',
            date: new Date(),
            paymentMethod: 'Manual Reset',
            transactionId: 'subscription-reset',
            metadata: subscriptionHistory
          }
        }
      }
    );
    
    // Completely clear subscription data and reset to Starter
    await User.updateOne(
      { uid },
      { 
        role: 'Starter',
        $unset: {
          subscriptionStartDate: 1,
          subscriptionEndDate: 1,
          'subscription.paypalSubscriptionId': 1,
          'subscription.planId': 1,
          'subscription.nextBillingTime': 1
        },
        $set: {
          'subscription.status': 'INACTIVE',
          'subscription.updatedAt': new Date()
        }
      }
    );
    
    console.log(`Successfully reset subscription data for user ${uid}`);
    
    res.status(200).json({
      success: true,
      message: 'Subscription data has been reset'
    });
  } catch (error) {
    console.error(`Error resetting subscription for user:`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error resetting subscription'
    });
  }
});

module.exports = router; 