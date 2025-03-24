require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { initScheduler } = require('./services/scheduler');
const tiktokRoutes = require('./routes/tiktok');
const twitterRoutes = require('./routes/twitter');
const uploadRoutes = require('./routes/upload');
const postsRoutes = require('./routes/posts');
const usersRoutes = require('./routes/users');
const paypalRoutes = require('./routes/paypal');
const rawBodyParser = require('./middleware/rawBodyParser');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3335;

// Connect to MongoDB
connectDB()
  .then(() => {
    console.log('MongoDB connection established');
    
    // Initialize the scheduler after DB connection is established
    initScheduler();
  })
  .catch(err => console.error('MongoDB connection error:', err?.message));

// Log environment variables (without secrets)
console.log('Environment:');
console.log('- PORT:', port);
console.log('- BACKEND_URL:', process.env.BACKEND_URL);
console.log('- FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('- R2_BUCKET_NAME:', process.env.R2_BUCKET_NAME);
console.log('- R2_ENDPOINT:', process.env.R2_ENDPOINT);
console.log('- R2_PUBLIC_DOMAIN:', process.env.R2_PUBLIC_DOMAIN);

// Enable CORS for frontend with proper configuration
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://sociallane-frontend.mindio.chat',
  'http://localhost:3334',
  'http://localhost:3000',
  'https://media.mindio.chat'
];

console.log('CORS allowed origins:', allowedOrigins);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // For development purposes, log all origins
    console.log('Request origin:', origin);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      console.log('CORS blocked origin:', origin);
      // Instead of returning an error, allow all origins in development
      // return callback(new Error('CORS policy violation'), false);
      return callback(null, true); // Allow all origins for now to debug
    }
    
    console.log('CORS allowed origin:', origin);
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Access-Token'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true,
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours
}));

// Ensure preflight requests are handled properly
app.options('*', (req, res) => {
  // Set CORS headers explicitly for OPTIONS requests
  res.header('Access-Control-Allow-Origin', req.header('origin') || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Access-Token');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.status(200).end();
});

// Add timeout middleware
app.use((req, res, next) => {
  // Set a timeout for all requests (2 minutes)
  req.setTimeout(120000, () => {
    console.error('Request timeout exceeded');
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout exceeded' });
    }
  });
  next();
});

// Raw body parser middleware for PayPal webhooks
app.use(rawBodyParser);

// Parse JSON bodies
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  
  // Log request body for POST requests but omit sensitive data
  if (req.method === 'POST' && req.body) {
    const sanitizedBody = { ...req.body };
    
    // Remove sensitive fields
    ['accessToken', 'refreshToken', 'accessTokenSecret'].forEach(field => {
      if (sanitizedBody[field]) sanitizedBody[field] = '***REDACTED***';
    });
    
    console.log(`Request body: ${JSON.stringify(sanitizedBody, null, 2)}`);
  }
  
  next();
});

// Add specific CORS headers for TikTok routes
app.use('/tiktok', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'https://sociallane-frontend.mindio.chat');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Add specific CORS headers for Twitter routes
app.use('/twitter', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'https://sociallane-frontend.mindio.chat');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Routes
app.use('/tiktok', tiktokRoutes);
app.use('/twitter', twitterRoutes);
app.use('/upload', uploadRoutes);
app.use('/posts', postsRoutes);
app.use('/users', usersRoutes);
app.use('/paypal', paypalRoutes);

// Forward /schedules to /posts for backward compatibility
app.post('/schedules', (req, res) => {
  console.log('Forwarding request from /schedules to /posts for scheduling');
  req.url = '/';
  postsRoutes(req, res);
});

// Add a route handler for social/tiktok/post that forwards to the TikTok post-video endpoint
app.post('/social/tiktok/post', async (req, res) => {
  // Forward this request to the tiktok/post-video endpoint
  console.log('Forwarding request from /social/tiktok/post to /tiktok/post-video');
  
  // Log the incoming payload structure
  console.log('Incoming payload structure:', {
    keys: req.body ? Object.keys(req.body) : [],
    hasVideoUrl: !!req.body?.videoUrl,
    hasAccounts: Array.isArray(req.body?.accounts) && req.body?.accounts.length > 0,
    hasCaption: !!req.body?.caption,
    accountsCount: Array.isArray(req.body?.accounts) ? req.body.accounts.length : 0
  });
  
  // Handle multiple accounts case
  if (req.body?.accounts && Array.isArray(req.body.accounts) && req.body.accounts.length > 0) {
    const accounts = req.body.accounts;
    const videoUrl = req.body.videoUrl || '';
    const caption = req.body.caption || '';
    const results = [];
    
    // Process each account in sequence
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      
      try {
        console.log(`Processing TikTok account ${i+1}/${accounts.length}: ${account.displayName || account.openId}`);
        
        // Create a new request for this account
        const accountRequest = {
          method: 'POST',
          url: `${process.env.BACKEND_URL}/tiktok/post-video`,
          data: {
            videoUrl: videoUrl,
            accessToken: account.accessToken || '',
            refreshToken: account.refreshToken || '',
            caption: caption
          },
          headers: {
            'Content-Type': 'application/json'
          }
        };
        
        // Send request to the tiktok/post-video endpoint
        const response = await axios(accountRequest);
        
        results.push({
          accountId: account.openId,
          displayName: account.displayName,
          success: true,
          data: response.data
        });
        
        // Add a small delay between account requests to avoid rate limiting
        if (i < accounts.length - 1) {
          console.log(`Waiting 3 seconds before processing next TikTok account...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } catch (error) {
        console.error(`Error posting to TikTok account ${account.displayName || account.openId}:`, error?.message);
        
        results.push({
          accountId: account.openId,
          displayName: account.displayName,
          success: false,
          error: error?.message || 'Unknown error'
        });
      }
    }
    
    // Return the combined results
    return res.status(200).json({
      success: results.some(r => r.success), // Overall success if at least one account succeeded
      message: `Posted to ${results.filter(r => r.success).length}/${accounts.length} TikTok accounts`,
      results: results
    });
  } 
  // Handle single account cases (legacy format or direct access token)
  else {
    // Transform the payload to match what tiktok/post-video expects
    const originalBody = { ...req.body };
    let transformedBody = {};
    
    // Case 2: Direct format with accessToken already present
    if (req.body?.accessToken) {
      transformedBody = {
        videoUrl: req.body.videoUrl || '',
        accessToken: req.body.accessToken,
        refreshToken: req.body.refreshToken || '',
        caption: req.body.caption || ''
      };
      console.log('Using direct accessToken format');
    }
    // Case 3: Handle tiktokPayload format from social-posting.js
    else if (req.body?.tiktokPayload) {
      const payload = req.body.tiktokPayload;
      if (payload.accounts && payload.accounts.length > 0) {
        const firstAccount = payload.accounts[0];
        transformedBody = {
          videoUrl: payload.videoUrl || '',
          accessToken: firstAccount.accessToken || '',
          refreshToken: firstAccount.refreshToken || '',
          caption: payload.caption || ''
        };
        console.log('Transformed from tiktokPayload format');
      }
    }
    
    // Check if we have the required fields
    if (transformedBody.videoUrl && transformedBody.accessToken) {
      req.body = transformedBody;
      
      console.log('Transformed payload:', {
        hasVideoUrl: !!req.body.videoUrl,
        hasAccessToken: !!req.body.accessToken,
        hasRefreshToken: !!req.body.refreshToken,
        hasCaption: !!req.body.caption
      });
    } else {
      console.error('Failed to extract required fields from payload');
      console.error('Original payload keys:', Object.keys(originalBody));
      // Keep original body, the endpoint will return appropriate error
    }
    
    req.url = '/post-video';
    tiktokRoutes(req, res);
  }
});

// TikTok domain verification file
app.get('/tiktokxhM8HSGWC6UXDSySEBMtLOBidATHhofG.txt', (req, res) => {
  res.type('text/plain');
  res.send('tiktok-developers-site-verification=xhM8HSGWC6UXDSySEBMtLOBidATHhofG');
});

// Basic health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'API is running',
    environment: {
      backend_url: process.env.BACKEND_URL,
      frontend_url: process.env.FRONTEND_URL,
      r2_public_domain: process.env.R2_PUBLIC_DOMAIN
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Backend URL: ${process.env.BACKEND_URL}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`R2 Public Domain: ${process.env.R2_PUBLIC_DOMAIN}`);
});