const express = require('express');
const router = express.Router();
const User = require('../models/User');
const paypalService = require('../services/paypalService');

// Create a subscription
router.post('/create-subscription', async (req, res) => {
  try {
    const { uid } = req.body;
    console.log(`Creating subscription for user: ${uid}`);

    if (!uid) {
      console.log('User ID is required but was not provided');
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Find the user
    const user = await User.findOne({ uid });
    if (!user) {
      console.log(`User not found with ID: ${uid}`);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if user already has an active subscription
    if (user.subscription?.status === 'ACTIVE') {
      console.log(`User ${uid} already has an active subscription: ${user.subscription.paypalSubscriptionId}`);
      return res.status(400).json({
        success: false,
        error: 'User already has an active subscription'
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
          await User.findOneAndUpdate(
            { uid },
            {
              role: 'Pro',
              'subscription.status': 'ACTIVE',
              'subscription.updatedAt': new Date()
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
      returnUrl: `${process.env.BACKEND_URL}/paypal/subscription-success?uid=${uid}`,
      cancelUrl: `${process.env.FRONTEND_URL}/subscription?status=cancelled&uid=${uid}`
    });

    console.log(`Created PayPal subscription: ${subscription.id} for user: ${uid}`);

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

    console.log(`Updated user ${uid} with pending subscription: ${subscription.id}`);

    // Return the approval URL to redirect the user
    res.status(200).json({
      success: true,
      data: {
        subscriptionId: subscription.id,
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
    const { uid, subscription_id } = req.query;
    console.log(`Handling subscription success for user: ${uid}, subscription: ${subscription_id}`);
    
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
    
    // Update user with active subscription
    const user = await User.findOneAndUpdate(
      { uid },
      {
        role: 'Pro',
        subscriptionStartDate: new Date(),
        'subscription.paypalSubscriptionId': subscription_id,
        'subscription.status': subscriptionDetails.status,
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

    console.log(`Updated user ${uid} with active subscription: ${subscription_id}`);

    // Redirect to frontend with success status
    res.redirect(`${process.env.FRONTEND_URL}/my-account?subscription=success&uid=${uid}`);
  } catch (error) {
    console.error('Error handling subscription success:', error);
    res.redirect(`${process.env.FRONTEND_URL}/my-account?subscription=error&message=${encodeURIComponent(error.message)}`);
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

    // Check if subscription has expired but user still has Pro role
    const now = new Date();
    if (user.role === 'Pro' && 
        user.subscription.status === 'CANCELLED' && 
        user.subscriptionEndDate && 
        user.subscriptionEndDate < now) {
      
      console.log(`User ${uid} has expired subscription (end date: ${user.subscriptionEndDate.toISOString()}) but still has Pro role. Downgrading to Free.`);
      
      // Update user to Free role
      await User.findOneAndUpdate(
        { uid },
        {
          role: 'Free',
          'subscription.status': 'EXPIRED'
        }
      );
      
      // Reload user with updated data
      const updatedUser = await User.findOne({ uid });
      user.role = updatedUser.role;
      user.subscription.status = updatedUser.subscription.status;
      
      console.log(`User ${uid} has been downgraded to Free role due to expired subscription`);
    }

    // Get subscription details from PayPal if it exists
    try {
      console.log(`Fetching subscription details from PayPal for: ${user.subscription.paypalSubscriptionId}`);
      const subscriptionDetails = await paypalService.getSubscription(user.subscription.paypalSubscriptionId);
      
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
            ...(subscriptionDetails.status !== 'ACTIVE' && { role: 'Free' })
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
          role: subscriptionDetails.status === 'ACTIVE' ? 'Pro' : 'Free',
          planId: subscriptionDetails.plan_id,
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

// Cancel subscription
router.post('/:uid/cancel-subscription', async (req, res) => {
  try {
    const { uid } = req.params;
    const { reason } = req.body;
    console.log(`Cancelling subscription for user: ${uid}, reason: ${reason || 'Not provided'}`);
    
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
      console.log(`User ${uid} has no active subscription to cancel`);
      return res.status(400).json({
        success: false,
        error: 'User has no active subscription'
      });
    }

    // Cancel subscription with PayPal
    const cancelResult = await paypalService.cancelSubscription(
      user.subscription.paypalSubscriptionId, 
      reason || 'Cancelled by user'
    );

    console.log(`PayPal cancellation result for ${user.subscription.paypalSubscriptionId}: ${JSON.stringify(cancelResult)}`);

    // Get the subscription details to get the next billing time (which will be the end date)
    const subscriptionDetails = await paypalService.getSubscription(user.subscription.paypalSubscriptionId);
    const nextBillingTime = subscriptionDetails?.billing_info?.next_billing_time;
    
    // Ensure we have a valid end date
    let endDate;
    if (nextBillingTime) {
      endDate = new Date(nextBillingTime);
    } else {
      // If no next billing time is available, set end date to 30 days from now as fallback
      endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);
      console.log(`No next billing time available, using fallback end date: ${endDate.toISOString()}`);
    }
    
    console.log(`Setting subscription end date to: ${endDate.toISOString()}`);

    // Update user subscription status but keep Pro role until the end of billing period
    await User.findOneAndUpdate(
      { uid },
      {
        'subscription.status': 'CANCELLED',
        'subscription.updatedAt': new Date(),
        'subscription.nextBillingTime': endDate,
        // Set the subscription end date to the next billing time
        subscriptionEndDate: endDate,
        // Don't change the role to Free immediately - they remain Pro until the end of billing period
        // role: 'Free'
      }
    );

    console.log(`Updated user ${uid} with cancelled subscription status, Pro access until ${endDate.toISOString()}`);

    res.status(200).json({
      success: true,
      message: 'Subscription cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error cancelling subscription'
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

    // Update user subscription status
    await User.findOneAndUpdate(
      { 'subscription.paypalSubscriptionId': subscriptionId },
      {
        role: 'Pro',
        'subscription.status': 'ACTIVE',
        'subscription.updatedAt': new Date(),
        'subscription.nextBillingTime': new Date(resource.billing_info?.next_billing_time || Date.now()),
        subscriptionStartDate: new Date()
      }
    );
    
    console.log(`Successfully updated user ${user.uid} with activated subscription`);
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
    // If the subscription is cancelled but next_billing_time is in the future, they still have Pro access
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
    
    // Update user subscription status
    const updateData = {
      'subscription.status': resource.status,
      'subscription.updatedAt': new Date(),
    };
    
    // Add next billing time if available
    if (endDate) {
      updateData['subscription.nextBillingTime'] = endDate;
    }
    
    // Only update role to Free if subscription is no longer active and not in the "cancelled but active" state
    if (!isCancelledButActive && resource.status !== 'ACTIVE') {
      updateData.role = 'Free';
    }
    
    // Set the subscription end date if the subscription is cancelled
    if (resource.status === 'CANCELLED' && endDate) {
      updateData.subscriptionEndDate = endDate;
      console.log(`Setting subscription end date to: ${endDate.toISOString()}`);
    }
    
    await User.findOneAndUpdate(
      { 'subscription.paypalSubscriptionId': subscriptionId },
      updateData
    );
    
    if (isCancelledButActive) {
      console.log(`User ${user.uid} has cancelled subscription but retains Pro access until ${endDate ? endDate.toISOString() : 'unknown'}`);
    } else {
      console.log(`Successfully updated user ${user.uid} with subscription status: ${resource.status}`);
    }
  } catch (error) {
    console.error('Error handling subscription updated webhook:', error);
  }
}

async function handleSubscriptionCancelled(resource) {
  try {
    const subscriptionId = resource.id;
    console.log(`Processing subscription cancelled webhook for: ${subscriptionId}`);
    
    // Find user with this subscription ID
    const user = await User.findOne({ 'subscription.paypalSubscriptionId': subscriptionId });
    if (!user) {
      console.error(`User not found for subscription: ${subscriptionId}`);
      return;
    }

    console.log(`Updating user ${user.uid} with cancelled subscription`);

    // Get the next billing time which will be the end date of Pro access
    const nextBillingTime = resource.billing_info?.next_billing_time;
    
    // Ensure we have a valid end date
    let endDate;
    if (nextBillingTime) {
      endDate = new Date(nextBillingTime);
    } else {
      // If no next billing time is available, set end date to 30 days from now as fallback
      endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);
      console.log(`No next billing time available, using fallback end date: ${endDate.toISOString()}`);
    }
    
    console.log(`Setting subscription end date to: ${endDate.toISOString()}`);
    
    // Update user subscription status but keep Pro role until the end of billing period
    await User.findOneAndUpdate(
      { 'subscription.paypalSubscriptionId': subscriptionId },
      {
        // Don't change role to Free immediately - they remain Pro until the end of billing period
        // role: 'Free',
        'subscription.status': 'CANCELLED',
        'subscription.updatedAt': new Date(),
        'subscription.nextBillingTime': endDate,
        // Set the subscription end date to the next billing time
        subscriptionEndDate: endDate
      }
    );
    
    console.log(`Successfully updated user ${user.uid} with cancelled subscription, Pro access until ${endDate.toISOString()}`);
  } catch (error) {
    console.error('Error handling subscription cancelled webhook:', error);
  }
}

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
        role: 'Free',
        'subscription.status': 'SUSPENDED',
        'subscription.updatedAt': new Date()
      }
    );
    
    console.log(`Successfully updated user ${user.uid} with suspended subscription`);
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
    const now = new Date();
    console.log('Running manual subscription expiration check at', now.toISOString());
    
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
      
      return { success: true, count: expiredUsers.length };
    } else {
      console.log('No users with expired Pro subscriptions found');
      
      // For debugging, find all Pro users with CANCELLED status
      const allCancelledProUsers = await User.find({
        role: 'Pro',
        'subscription.status': 'CANCELLED'
      });
      
      console.log(`Found ${allCancelledProUsers.length} Pro users with CANCELLED status`);
      
      allCancelledProUsers.forEach(user => {
        console.log(`Cancelled Pro user: ${user.uid} (${user.email}), End date: ${user.subscriptionEndDate}, Current date: ${now.toISOString()}, Is expired: ${user.subscriptionEndDate < now}`);
      });
      
      return { success: true, count: 0 };
    }
  } catch (error) {
    console.error('Error in manual subscription expiration checker:', error?.message);
    return { success: false, error: error?.message };
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

module.exports = router; 