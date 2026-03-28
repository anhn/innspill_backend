const express = require('express');
const passport = require('passport');
const FacebookStrategy = require('passport-facebook').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { isOptionalAuth, isAuthenticated } = require('../middleware/auth');
const router = express.Router();

/**
 * GET /api/v1/auth
 * List available auth endpoints
 */
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Authentication API',
    endpoints: {
      login: 'POST /api/v1/auth/login',
      register: 'POST /api/v1/auth/register',
      'create-user': 'POST /api/v1/auth/create-user',
      facebook: 'GET /api/v1/auth/facebook',
      google: 'GET /api/v1/auth/google',
      logout: 'GET /api/v1/auth/logout',
      me: 'GET /api/v1/auth/me'
    }
  });
});

/**
 * POST /api/v1/auth/register
 * Register a new user
 */
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, type, remark } = req.body;

    // Validate request body
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Validate password strength (minimum 6 characters)
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists (by email or username)
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: email.toLowerCase() }
      ]
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Determine user type (same logic as /create-user)
    const validTypes = ['teacher', 'student', 'school'];
    const userType = type || 'teacher';
    if (!validTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid user type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    // Create new user
    const newUser = new User({
      username: email.toLowerCase(), // Use email as username for login
      email: email.toLowerCase(),
      fullName: name,
      password: hashedPassword,
      type: userType,
      remark: remark || '',
      date_created: new Date()
    });

    await newUser.save();

    // Create session for the new user
    req.session.userId = newUser._id.toString();
    req.session.username = newUser.username;
    req.session.userRole = newUser.type;

    console.log('✅ Registration successful:', email);

    // Return success response
    return res.status(201).json({
      success: true,
      user: {
        username: newUser.username,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.type
      },
      sessionId: req.sessionID,
      message: 'Registration successful'
    });

  } catch (error) {
    console.error('❌ Registration error:', error.message);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * POST /api/v1/auth/create-user
 * Create a general user (can specify type: teacher, student, or admin)
 */
router.post('/create-user', isOptionalAuth, async (req, res) => {
  try {
    const { name, email, password, type, remark } = req.body;

    // Validate request body
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Validate password strength (minimum 6 characters)
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Validate user type if provided
    const validTypes = ['teacher', 'student', 'school'];
    const userType = type || 'teacher';
    if (!validTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid user type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    // Check if user already exists (by email or username)
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: email.toLowerCase() }
      ]
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create new user
    const newUser = new User({
      username: email.toLowerCase(), // Use email as username for login
      email: email.toLowerCase(),
      fullName: name,
      password: hashedPassword,
      type: userType,
      remark: remark || '', // Can store courseId for students
      date_created: new Date()
    });

    await newUser.save();

    console.log(`✅ User created successfully: ${email} (type: ${userType})`);

    // Return success response (no session created - different from register)
    return res.status(201).json({
      success: true,
      data: {
        id: newUser._id.toString(),
        username: newUser.username,
        email: newUser.email,
        fullName: newUser.fullName,
        type: newUser.type,
        remark: newUser.remark,
        date_created: newUser.date_created
      },
      message: 'User created successfully'
    });

  } catch (error) {
    console.error('❌ Error creating user:', error.message);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'User with this email or username already exists'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/auth/login
 * Authenticate user with username and password
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate request body
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    // Find user in database (support both username and email)
    const user = await User.findOne({
      $or: [
        { username: username.toLowerCase() },
        { email: username.toLowerCase() }
      ]
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Check password - support both hashed and plain text (for backward compatibility)
    let passwordMatch = false;
    
    // Try bcrypt comparison first (for new hashed passwords)
    try {
      passwordMatch = await bcrypt.compare(password, user.password);
    } catch (err) {
      // If bcrypt fails, try plain text comparison (for old passwords)
      passwordMatch = user.password === password;
    }

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Create session
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    req.session.userRole = user.type;

    // Generate sessionId
    const sessionId = req.sessionID;

    console.log('✅ Login successful:', username);

    // Return success response
    return res.status(200).json({
      success: true,
      user: {
        username: user.username,
        email: user.email || '',
        fullName: user.fullName || '',
        role: user.type,
        country: ''
      },
      sessionId: sessionId,
      message: 'Login successful'
    });

  } catch (error) {
    console.error('❌ Login error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
      errorType: error.name
    });
  }
});

// Configure Passport strategies
passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID,
  clientSecret: process.env.FACEBOOK_APP_SECRET,
  callbackURL: `${process.env.SERVER_URL}/api/v1/auth/facebook/callback`,
  profileFields: ['id', 'emails', 'name']
}, (accessToken, refreshToken, profile, done) => {
  // Store user info in session
  const user = {
    id: profile.id,
    email: profile.emails[0].value,
    name: profile.name.givenName + ' ' + profile.name.familyName,
    provider: 'facebook'
  };
  return done(null, user);
}));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.SERVER_URL}/api/v1/auth/google/callback`
}, (accessToken, refreshToken, profile, done) => {
  // Store user info in session
  const user = {
    id: profile.id,
    email: profile.emails[0].value,
    name: profile.displayName,
    provider: 'google'
  };
  return done(null, user);
}));

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

/**
 * GET /api/v1/auth/facebook
 * Initiate Facebook authentication
 */
router.get('/facebook', passport.authenticate('facebook', {
  scope: ['email']
}));

/**
 * GET /api/v1/auth/facebook/callback
 * Facebook authentication callback
 */
router.get('/facebook/callback', 
  passport.authenticate('facebook', { failureRedirect: `${process.env.CLIENT_URL}/login?error=facebook` }),
  (req, res) => {
    // Store user info in session
    req.session.userId = req.user.id;
    req.session.userEmail = req.user.email;
    req.session.userName = req.user.name;
    req.session.provider = req.user.provider;
    
    res.redirect(`${process.env.CLIENT_URL}/dashboard`);
  }
);

/**
 * GET /api/v1/auth/google
 * Initiate Google authentication
 */
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

/**
 * GET /api/v1/auth/google/callback
 * Google authentication callback
 */
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: `${process.env.CLIENT_URL}/login?error=google` }),
  (req, res) => {
    // Store user info in session
    req.session.userId = req.user.id;
    req.session.userEmail = req.user.email;
    req.session.userName = req.user.name;
    req.session.provider = req.user.provider;
    
    res.redirect(`${process.env.CLIENT_URL}/dashboard`);
  }
);

/**
 * GET /api/v1/auth/logout
 * Logout user
 * Query params: ?redirect=true to redirect to client login page
 */
router.get('/logout', (req, res) => {
  const shouldRedirect = req.query.redirect === 'true';
  
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        error: 'Could not log out'
      });
    }
    res.clearCookie('connect.sid');
    
    // If redirect requested and CLIENT_URL is set, redirect
    if (shouldRedirect && process.env.CLIENT_URL) {
      return res.redirect(`${process.env.CLIENT_URL}/login`);
    }
    
    // Otherwise return JSON response
    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  });
});

/**
 * GET /api/v1/auth/me
 * Get current user info
 */
router.get('/me', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({
      success: true,
      user: {
        id: req.session.userId,
        email: req.session.userEmail,
        name: req.session.userName,
        provider: req.session.provider
      }
    });
  } else {
    res.json({
      success: false,
      user: null
    });
  }
});

/**
 * GET /api/v1/auth/registration-date
 * Get the registration date of the current user
 * Requires authentication
 */
router.get('/registration-date', isOptionalAuth, async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userId = req.session.userId;
    const username = req.session.username;

    // Find user in database
    const user = await User.findOne({
      $or: [
        { _id: userId },
        { username: username }
      ]
    }).select('date_created username fullName').lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Return registration date
    return res.status(200).json({
      success: true,
      data: {
        registrationDate: user.date_created ? user.date_created.toISOString() : null,
        registrationDateFormatted: user.date_created ? user.date_created.toLocaleDateString() : null,
        username: user.username,
        fullName: user.fullName || ''
      }
    });

  } catch (error) {
    console.error('❌ Error getting registration date:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/auth/change-password
 * Change user password (requires authentication)
 * 
 * Request Body:
 * {
 *   "currentPassword": "string",  // Required: current password for verification
 *   "newPassword": "string",       // Required: new password (min 6 characters)
 *   "confirmPassword": "string"   // Required: must match newPassword
 * }
 * 
 * Response (Success):
 * {
 *   "success": true,
 *   "message": "Password changed successfully"
 * }
 * 
 * Response (Error):
 * {
 *   "success": false,
 *   "message": "Error message here"
 * }
 */
router.post('/change-password', isAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Validate request body
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password, new password, and confirm password are required'
      });
    }

    // Validate password strength (minimum 6 characters)
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    // Validate that new password matches confirm password
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password do not match'
      });
    }

    // Validate that new password is different from current password
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from current password'
      });
    }

    // Get user from session
    const userId = req.session.userId;
    const username = req.session.username;

    // Find user in database
    const user = await User.findOne({
      $or: [
        { _id: userId },
        { username: username }
      ]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    let passwordMatch = false;
    
    // Try bcrypt comparison first (for hashed passwords)
    try {
      passwordMatch = await bcrypt.compare(currentPassword, user.password);
    } catch (err) {
      // If bcrypt fails, try plain text comparison (for backward compatibility)
      passwordMatch = user.password === currentPassword;
    }

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update user password
    user.password = hashedPassword;
    await user.save();

    console.log('✅ Password changed successfully for user:', username);

    // Return success response
    return res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('❌ Error changing password:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;
