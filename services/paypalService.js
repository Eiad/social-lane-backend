const axios = require('axios');

/**
 * PayPal Service for handling subscription operations
 */
class PayPalService {
  constructor() {
    this.baseURL = process.env.NODE_ENV === 'production' 
      ? 'https://api-m.paypal.com' 
      : 'https://api-m.sandbox.paypal.com';
    this.clientId = process.env.PAYPAL_CLIENT_ID;
    this.clientSecret = process.env.PAYPAL_SECRET;
    
    // Plan IDs for each subscription tier
    this.planIds = {
      Launch: process.env.NODE_ENV === 'production' 
        ? 'P-6G167743VS6723099OOSIGY' // Keep existing Pro plan ID as Launch
        : 'P-6G167743VS6723046M7HSIGY', // Keep existing sandbox plan ID as Launch
      Rise: process.env.NODE_ENV === 'production'
        ? process.env.PAYPAL_RISE_PLAN_ID || 'P-RISE_PLAN_ID'
        : process.env.PAYPAL_RISE_PLAN_ID_SANDBOX || 'P-RISE_PLAN_ID_SANDBOX',
      Scale: process.env.NODE_ENV === 'production'
        ? process.env.PAYPAL_SCALE_PLAN_ID || 'P-SCALE_PLAN_ID'
        : process.env.PAYPAL_SCALE_PLAN_ID_SANDBOX || 'P-SCALE_PLAN_ID_SANDBOX'
    };
    
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get access token for PayPal API
   * @returns {Promise<string>} Access token
   */
  async getAccessToken() {
    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > Date.now()) {
      console.log('Using cached PayPal access token');
      return this.accessToken;
    }

    try {
      console.log('Requesting new PayPal access token');
      const response = await axios({
        method: 'post',
        url: `${this.baseURL}/v1/oauth2/token`,
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'en_US',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        auth: {
          username: this.clientId,
          password: this.clientSecret,
        },
        data: 'grant_type=client_credentials',
      });

      this.accessToken = response.data.access_token;
      // Set token expiry (subtract 60 seconds to be safe)
      this.tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
      
      console.log('Successfully obtained new PayPal access token');
      return this.accessToken;
    } catch (error) {
      console.error('Error getting PayPal access token:', error?.response?.data || error.message);
      throw new Error('Failed to get PayPal access token');
    }
  }

  /**
   * Create a subscription for a user
   * @param {Object} options - Subscription options
   * @param {string} options.returnUrl - URL to redirect after approval
   * @param {string} options.cancelUrl - URL to redirect if canceled
   * @param {string} options.planTier - Subscription tier (Launch, Rise, or Scale)
   * @returns {Promise<Object>} Subscription details with approval URL
   */
  async createSubscription(options) {
    try {
      console.log('Creating PayPal subscription with options:', options);
      const token = await this.getAccessToken();
      
      // Default to Launch tier if not specified
      const planTier = options.planTier || 'Launch';
      const planId = this.planIds[planTier];
      
      if (!planId) {
        throw new Error(`Invalid plan tier: ${planTier}`);
      }
      
      console.log(`Using plan ID for ${planTier} tier: ${planId}`);
      
      const response = await axios({
        method: 'post',
        url: `${this.baseURL}/v1/billing/subscriptions`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'PayPal-Request-Id': `subscription-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        },
        data: {
          plan_id: planId,
          application_context: {
            brand_name: 'Social Lane',
            locale: 'en-US',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'SUBSCRIBE_NOW',
            payment_method: {
              payer_selected: 'PAYPAL',
              payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED',
            },
            return_url: options.returnUrl,
            cancel_url: options.cancelUrl,
          },
        },
      });

      console.log('Successfully created PayPal subscription:', response.data.id);
      return response.data;
    } catch (error) {
      console.error('Error creating PayPal subscription:', error?.response?.data || error.message);
      throw new Error('Failed to create PayPal subscription');
    }
  }

  /**
   * Get subscription details
   * @param {string} subscriptionId - PayPal subscription ID
   * @returns {Promise<Object>} Subscription details
   */
  async getSubscription(subscriptionId) {
    try {
      console.log('Fetching PayPal subscription details for:', subscriptionId);
      const token = await this.getAccessToken();
      
      const response = await axios({
        method: 'get',
        url: `${this.baseURL}/v1/billing/subscriptions/${subscriptionId}`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      console.log('PayPal subscription details retrieved:', {
        id: response.data.id,
        status: response.data.status,
        plan_id: response.data.plan_id,
        next_billing_time: response.data.billing_info?.next_billing_time
      });
      
      return response.data;
    } catch (error) {
      console.error('Error getting PayPal subscription:', error?.response?.data || error.message);
      throw new Error('Failed to get PayPal subscription details');
    }
  }

  /**
   * Cancel a subscription
   * @param {string} subscriptionId - PayPal subscription ID
   * @param {string} reason - Reason for cancellation
   * @returns {Promise<Object>} Cancellation result
   */
  async cancelSubscription(subscriptionId, reason = 'Canceled by user') {
    try {
      console.log(`Cancelling PayPal subscription ${subscriptionId} with reason: ${reason}`);
      const token = await this.getAccessToken();
      
      // First, check the current status of the subscription
      const subscriptionDetails = await this.getSubscription(subscriptionId);
      console.log(`Current subscription status: ${subscriptionDetails.status}`);
      
      // If already cancelled, just return success
      if (subscriptionDetails.status === 'CANCELLED' || 
          subscriptionDetails.status === 'EXPIRED' || 
          subscriptionDetails.status === 'SUSPENDED') {
        console.log(`Subscription ${subscriptionId} is already in ${subscriptionDetails.status} state, no need to cancel`);
        return { success: true, status: subscriptionDetails.status };
      }
      
      // Proceed with cancellation
      const response = await axios({
        method: 'post',
        url: `${this.baseURL}/v1/billing/subscriptions/${subscriptionId}/cancel`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        data: {
          reason,
        },
      });

      console.log(`Successfully cancelled PayPal subscription ${subscriptionId}`);
      
      // Verify the cancellation by getting the subscription details again
      const verifyDetails = await this.getSubscription(subscriptionId);
      console.log(`Verified subscription status after cancellation: ${verifyDetails.status}`);
      
      return { success: true, status: 'CANCELLED' };
    } catch (error) {
      console.error('Error canceling PayPal subscription:', error?.response?.data || error.message);
      throw new Error('Failed to cancel PayPal subscription');
    }
  }

  /**
   * Verify webhook signature from PayPal
   * @param {Object} headers - Request headers
   * @param {string} body - Request body as string
   * @returns {Promise<boolean>} Whether the webhook is valid
   */
  async verifyWebhookSignature(headers, body) {
    try {
      console.log('Verifying PayPal webhook signature');
      const token = await this.getAccessToken();
      
      const response = await axios({
        method: 'post',
        url: `${this.baseURL}/v1/notifications/verify-webhook-signature`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        data: {
          auth_algo: headers['paypal-auth-algo'],
          cert_url: headers['paypal-cert-url'],
          transmission_id: headers['paypal-transmission-id'],
          transmission_sig: headers['paypal-transmission-sig'],
          transmission_time: headers['paypal-transmission-time'],
          webhook_id: process.env.PAYPAL_WEBHOOK_ID || '',
          webhook_event: typeof body === 'string' ? JSON.parse(body) : body,
        },
      });

      const isValid = response.data.verification_status === 'SUCCESS';
      console.log(`PayPal webhook signature verification: ${isValid ? 'SUCCESS' : 'FAILED'}`);
      return isValid;
    } catch (error) {
      console.error('Error verifying PayPal webhook:', error?.response?.data || error.message);
      return false;
    }
  }

  /**
   * Get the subscription tier from plan ID
   * @param {string} planId - PayPal plan ID
   * @returns {string} Subscription tier (Launch, Rise, Scale or Starter if unknown)
   */
  getPlanTierFromId(planId) {
    for (const [tier, id] of Object.entries(this.planIds)) {
      if (id === planId) {
        return tier;
      }
    }
    return 'Starter'; // Default to Starter if plan ID not recognized
  }
}

module.exports = new PayPalService(); 