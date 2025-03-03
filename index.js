require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { initScheduler } = require('./services/scheduler');
const tiktokRoutes = require('./routes/tiktok');
const twitterRoutes = require('./routes/twitter');
const uploadRoutes = require('./routes/upload');
const postsRoutes = require('./routes/posts');

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
  'https://media.mindio.chat'
];

console.log('CORS allowed origins:', allowedOrigins);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      console.log('CORS blocked origin:', origin);
      return callback(new Error('CORS policy violation'), false);
    }
    
    console.log('CORS allowed origin:', origin);
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Add OPTIONS handling for preflight requests
app.options('*', cors());

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

// Parse JSON bodies
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
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