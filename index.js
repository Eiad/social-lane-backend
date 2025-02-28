require('dotenv').config();
const express = require('express');
const cors = require('cors');
const tiktokRoutes = require('./routes/tiktok');

const app = express();
const port = process.env.PORT || 3335;

// Log environment variables (without secrets)
console.log('Environment:');
console.log('- PORT:', port);
console.log('- BACKEND_URL:', process.env.BACKEND_URL);
console.log('- FRONTEND_URL:', process.env.FRONTEND_URL);

// Enable CORS for frontend with proper configuration
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://sociallane-frontend.mindio.chat',
  'http://localhost:3334'
];

console.log('CORS allowed origins:', allowedOrigins);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      console.log('CORS blocked origin:', origin);
      return callback(null, false);
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

// Parse JSON bodies
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/tiktok', tiktokRoutes);

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
      frontend_url: process.env.FRONTEND_URL
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Backend URL: ${process.env.BACKEND_URL}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
});