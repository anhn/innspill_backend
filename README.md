# AI4EDU Backend API

A Node.js backend API with multi-agent system architecture for educational chatbot services, powered by OpenAI GPT-4o mini.

## Features

- 🤖 Multi-agent system architecture
- 🎓 Specialized educational agents
- 🔐 Social authentication (Facebook & Google)
- 💾 Session management with MongoDB
- 🔒 Security middleware (Helmet, CORS, Rate limiting)
- 📊 Request validation and error handling
- 🚀 OpenAI GPT-4o mini integration
- 📝 Comprehensive logging

## Agent System

The application uses a multi-agent architecture with specialized agents:

- **Course Plan Agent**: Creates and updates course plans
- **Lecture Plan Agent**: Designs detailed lecture plans
- **Feedback Analysis Agent**: Analyzes educational feedback
- **General Chat Agent**: Handles general educational queries

## API Endpoints

### Chatbot Endpoints

- `POST /api/v1/chatbot/create-course-plan` - Create a new course plan
- `POST /api/v1/chatbot/update-course-plan` - Update an existing course plan
- `POST /api/v1/chatbot/create-lecture-plan` - Create a detailed lecture plan
- `POST /api/v1/chatbot/analyze-feedback` - Analyze educational feedback
- `POST /api/v1/chatbot/asks` - General chatbot queries

### Authentication Endpoints

- `GET /api/v1/auth/facebook` - Initiate Facebook login
- `GET /api/v1/auth/google` - Initiate Google login
- `GET /api/v1/auth/logout` - Logout user
- `GET /api/v1/auth/me` - Get current user info

### Utility Endpoints

- `GET /api/v1/chatbot/agents` - Get information about available agents
- `GET /api/v1/chatbot/health` - Health check for chatbot service
- `GET /health` - General health check
- `GET /` - API information

## Installation

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file based on `env.example`:

   ```bash
   cp env.example .env
   ```

4. Add your configuration to the `.env` file:

   ```
   SESSION_SECRET=your_session_secret_here
   NODE_ENV=development

   FACEBOOK_APP_ID=your_facebook_app_id
   FACEBOOK_APP_SECRET=your_facebook_app_secret

   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret

   CLIENT_URL=http://localhost:3001
   SERVER_URL=http://localhost:3000

   MONGO_URI=your_mongodb_connection_string
   OPENAI_API_KEY=your_openai_api_key_here
   PORT=3000
   ```

## Usage

1. Start the development server:

   ```bash
   npm run dev
   ```

2. Or start the production server:
   ```bash
   npm start
   ```

The API will be available at `http://localhost:3000`

## Request Format

All chatbot endpoints expect a JSON payload with the following structure:

```json
{
  "message": "Your request message here",
  "context": {
    "courseType": "academic",
    "duration": "12 weeks",
    "level": "beginner",
    "subject": "Computer Science"
  }
}
```

### Context Options

Different endpoints support different context options:

#### Course Plan Context

- `courseType`: "academic", "professional", "workshop", "online", "blended"
- `duration`: Course duration
- `level`: Student level
- `subject`: Subject area

#### Lecture Plan Context

- `lectureDuration`: Duration in minutes (15-180)
- `topic`: Lecture topic
- `classSize`: Number of students
- `environment`: "in-person", "online", "hybrid"

#### Feedback Analysis Context

- `feedbackType`: "student", "peer", "self", "administrative", "mixed"
- `courseId`: Course identifier
- `instructorId`: Instructor identifier
- `timeframe`: Analysis timeframe
- `responseCount`: Number of responses

## Response Format

All endpoints return a consistent JSON response:

```json
{
  "success": true,
  "agent": "Agent Name",
  "response": "AI-generated response",
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 200,
    "total_tokens": 300
  }
}
```

## Error Handling

The API includes comprehensive error handling:

- Input validation using Joi
- Rate limiting to prevent abuse
- Global error handler for unexpected errors
- Detailed error messages in development mode

## Security Features

- Helmet for security headers
- CORS configuration
- Rate limiting
- Input validation
- Error message sanitization in production

## Environment Variables

### Required Variables

- `SESSION_SECRET`: Secret key for session management
- `FACEBOOK_APP_ID`: Facebook App ID for authentication
- `FACEBOOK_APP_SECRET`: Facebook App Secret
- `GOOGLE_CLIENT_ID`: Google OAuth Client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth Client Secret
- `CLIENT_URL`: Frontend URL (e.g., http://localhost:3001)
- `SERVER_URL`: Backend URL (e.g., http://localhost:3000)
- `MONGO_URI`: MongoDB connection string
- `OPENAI_API_KEY`: Your OpenAI API key

### Optional Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)
- `RATE_LIMIT_WINDOW_MS`: Rate limit window (default: 15 minutes)
- `RATE_LIMIT_MAX_REQUESTS`: Max requests per window (default: 100)

## Development

The project uses:

- Express.js for the web framework
- OpenAI SDK for AI integration
- Passport.js for social authentication
- MongoDB with Mongoose for data persistence
- Express-session for session management
- Joi for request validation
- Morgan for logging
- Helmet for security
- CORS for cross-origin requests

## Deployment

### Prerequisites

Before deploying, ensure you have:

- Node.js 16.x or higher installed on your server
- MongoDB database (local or cloud like MongoDB Atlas)
- OpenAI API key
- Domain name (optional but recommended)
- SSL certificate (recommended for production)

### Environment Setup for Production

1. **Set NODE_ENV to production:**

   ```bash
   export NODE_ENV=production
   ```

2. **Configure environment variables:**
   Create a `.env` file with production values:

   ```
   NODE_ENV=production
   PORT=3000

   # Session
   SESSION_SECRET=your_strong_session_secret_here

   # Database
   MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/ai4edu_database?retryWrites=true&w=majority

   # OpenAI
   OPENAI_API_KEY=sk-your-openai-api-key-here

   # URLs
   CLIENT_URL=https://your-frontend-domain.com
   SERVER_URL=https://your-backend-domain.com

   # Social Authentication (optional)
   FACEBOOK_APP_ID=your_facebook_app_id
   FACEBOOK_APP_SECRET=your_facebook_app_secret
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret

   # Rate Limiting
   RATE_LIMIT_WINDOW_MS=900000
   RATE_LIMIT_MAX_REQUESTS=100
   ```

### Deployment Options

#### Option 1: Deploy to Heroku

1. **Install Heroku CLI:**

   ```bash
   npm install -g heroku
   ```

2. **Login to Heroku:**

   ```bash
   heroku login
   ```

3. **Create a new Heroku app:**

   ```bash
   heroku create your-app-name
   ```

4. **Set environment variables:**

   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set SESSION_SECRET=your_strong_secret
   heroku config:set MONGO_URI=your_mongodb_uri
   heroku config:set OPENAI_API_KEY=your_openai_key
   heroku config:set CLIENT_URL=https://your-frontend.com
   heroku config:set SERVER_URL=https://your-app-name.herokuapp.com
   ```

5. **Deploy:**

   ```bash
   git push heroku main
   ```

6. **Check logs:**
   ```bash
   heroku logs --tail
   ```

#### Option 2: Deploy to AWS EC2

1. **Launch an EC2 instance** (Ubuntu 20.04 or later)

2. **Connect to your instance:**

   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   ```

3. **Install Node.js:**

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

4. **Install PM2 (Process Manager):**

   ```bash
   sudo npm install -g pm2
   ```

5. **Clone your repository:**

   ```bash
   git clone https://github.com/your-username/AI4EDU_BE.git
   cd AI4EDU_BE
   ```

6. **Install dependencies:**

   ```bash
   npm install --production
   ```

7. **Create .env file with production values**

8. **Start the application with PM2:**

   ```bash
   pm2 start scripts/start.js --name ai4edu-backend
   pm2 save
   pm2 startup
   ```

9. **Configure Nginx as reverse proxy (optional):**

   ```bash
   sudo apt-get install nginx
   sudo nano /etc/nginx/sites-available/ai4edu
   ```

   Add this configuration:

   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

   Enable the site:

   ```bash
   sudo ln -s /etc/nginx/sites-available/ai4edu /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

#### Option 3: Deploy to DigitalOcean App Platform

1. **Create account on DigitalOcean**

2. **Click "Create" → "Apps"**

3. **Connect your GitHub repository**

4. **Configure the app:**
   - Name: `ai4edu-backend`
   - Branch: `main`
   - Build Command: `npm install`
   - Run Command: `npm start`

5. **Add environment variables** in the App Platform dashboard

6. **Deploy and get your app URL**

#### Option 4: Deploy to Render

1. **Create account on Render.com**

2. **Click "New +" → "Web Service"**

3. **Connect your repository**

4. **Configure:**
   - Name: `ai4edu-backend`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`

5. **Add environment variables** in the Environment tab

6. **Deploy**

#### Option 5: Deploy to cPanel (Namecheap)

cPanel hosting with Node.js support allows you to deploy your application using the Setup Node.js App feature available in most shared hosting environments including Namecheap.

**Prerequisites:**

- Namecheap shared hosting with cPanel and Node.js support
- SSH access enabled (recommended)
- Node.js version 16.x or higher available in cPanel

**Steps:**

1. **Prepare your application for production:**

   Add the following to your `package.json` if not already present:

   ```json
   {
     "engines": {
       "node": ">=16.0.0",
       "npm": ">=8.0.0"
     }
   }
   ```

2. **Upload your files via cPanel File Manager or FTP:**
   - Login to cPanel
   - Navigate to File Manager
   - Go to your domain's directory (usually `public_html/your-domain.com` or create a subdirectory)
   - Upload all project files EXCEPT:
     - `node_modules/` (will be installed on server)
     - `.env` (create separately on server)
     - `.git/` (optional, unless using Git deployment)

   **Alternative - Upload via SSH (recommended):**

   ```bash
   # Connect to your server via SSH
   ssh username@your-domain.com

   # Navigate to your application directory
   cd domains/your-domain.com

   # Clone your repository (if using Git)
   git clone https://github.com/your-username/AI4EDU_BE.git
   cd AI4EDU_BE

   # Or upload via rsync
   rsync -avz --exclude 'node_modules' --exclude '.env' ./ username@your-domain.com:~/domains/your-domain.com/
   ```

3. **Setup Node.js Application in cPanel:**
   - Login to cPanel
   - Search for "Setup Node.js App" (usually under "Software" section)
   - Click "Create Application"
   - Configure the application:
     - **Node.js version:** Select 16.x or higher
     - **Application mode:** Production
     - **Application root:** Path to your application (e.g., `domains/your-domain.com/AI4EDU_BE`)
     - **Application URL:** Your domain or subdomain (e.g., `api.your-domain.com`)
     - **Application startup file:** `scripts/start.js` (or `app.js`)
     - **Passenger log file:** (leave default or customize)
   - Click "Create"

4. **Install dependencies:**

   After creating the application, cPanel will show you commands to run. You need to enter the virtual environment:

   ```bash
   # Via cPanel Terminal or SSH
   source /home/username/nodevenv/domains/your-domain.com/AI4EDU_BE/16/bin/activate

   # Install production dependencies
   cd ~/domains/your-domain.com/AI4EDU_BE
   npm install --production
   ```

5. **Create and configure .env file:**

   Using cPanel File Manager or SSH, create a `.env` file in your application root:

   ```bash
   # Via SSH
   cd ~/domains/your-domain.com/AI4EDU_BE
   nano .env
   ```

   Add your production environment variables:

   ```
   NODE_ENV=production
   PORT=3000

   # Session
   SESSION_SECRET=your_strong_session_secret_here

   # Database
   MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/ai4edu_database

   # OpenAI
   OPENAI_API_KEY=sk-your-openai-api-key-here

   # URLs - Update these to match your domain
   CLIENT_URL=https://your-frontend-domain.com
   SERVER_URL=https://api.your-domain.com

   # Social Authentication
   FACEBOOK_APP_ID=your_facebook_app_id
   FACEBOOK_APP_SECRET=your_facebook_app_secret
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret

   # Rate Limiting
   RATE_LIMIT_WINDOW_MS=900000
   RATE_LIMIT_MAX_REQUESTS=100
   ```

6. **Configure environment variables in cPanel (Alternative):**

   Instead of using a `.env` file, you can set environment variables directly in cPanel:
   - Go to "Setup Node.js App"
   - Click on "Edit" for your application
   - Scroll to "Environment Variables" section
   - Add each variable (e.g., `NODE_ENV=production`)

7. **Setup SSL Certificate (Important):**
   - In cPanel, go to "SSL/TLS Status"
   - Enable SSL for your domain (Namecheap provides free Let's Encrypt SSL)
   - Or use "AutoSSL" to automatically secure your domain
   - Ensure your callback URLs for OAuth use HTTPS

8. **Configure OAuth Redirect URLs:**

   Update your OAuth app settings:

   **Facebook:**
   - Valid OAuth Redirect URIs: `https://api.your-domain.com/api/v1/auth/facebook/callback`

   **Google:**
   - Authorized redirect URIs: `https://api.your-domain.com/api/v1/auth/google/callback`

9. **Start/Restart the application:**
   - In cPanel "Setup Node.js App", click "Restart" button
   - Or via SSH:
     ```bash
     cd ~/domains/your-domain.com/AI4EDU_BE
     touch tmp/restart.txt  # Passenger restart trigger
     ```

10. **Setup subdomain for API (Optional but recommended):**
    - In cPanel, go to "Subdomains"
    - Create a subdomain: `api.your-domain.com`
    - Point document root to your Node.js application directory
    - Update Node.js app configuration to use this subdomain

11. **Configure .htaccess (if needed):**

    Create/edit `.htaccess` in your application root for proper routing:

    ```apache
    # Enable Passenger
    PassengerEnabled On
    PassengerAppRoot /home/username/domains/your-domain.com/AI4EDU_BE
    PassengerAppType node
    PassengerStartupFile scripts/start.js

    # Force HTTPS
    RewriteEngine On
    RewriteCond %{HTTPS} off
    RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
    ```

**Troubleshooting cPanel Deployment:**

1. **Application shows 503 Service Unavailable:**
   - Check application logs in cPanel Node.js App interface
   - Verify `package.json` has correct startup script
   - Ensure all dependencies are installed
   - Check file permissions (755 for directories, 644 for files)

2. **Cannot connect to MongoDB:**
   - Whitelist your cPanel server IP in MongoDB Atlas
   - Find your server IP: `curl ifconfig.me` or `hostname -I`
   - Verify MONGO_URI is correct

3. **Environment variables not loading:**
   - Ensure `.env` file is in the application root
   - Check file permissions on `.env` (644)
   - Try setting variables in cPanel interface instead
   - Restart the application after changes

4. **OAuth authentication fails:**
   - Verify SSL is enabled and working
   - Check callback URLs match exactly (including https://)
   - Ensure SESSION_SECRET is set
   - Check CORS configuration allows your frontend domain

5. **Application crashes or restarts frequently:**
   - Check error logs in cPanel or via SSH:
     ```bash
     tail -f ~/domains/your-domain.com/AI4EDU_BE/logs/error.log
     ```
   - Monitor memory usage (shared hosting has limits)
   - Optimize your application for lower resource usage

6. **Port conflicts:**
   - Don't specify a port in your application when using Passenger
   - Or bind to the port provided by Passenger:
     ```javascript
     const port = process.env.PORT || 3000;
     ```

**Updating your application:**

```bash
# Via SSH
cd ~/domains/your-domain.com/AI4EDU_BE

# Pull latest changes (if using Git)
git pull origin main

# Update dependencies
source /home/username/nodevenv/domains/your-domain.com/AI4EDU_BE/16/bin/activate
npm install --production

# Restart application
touch tmp/restart.txt
```

**Performance Tips for cPanel:**

- Use MongoDB Atlas instead of local MongoDB
- Enable caching where possible
- Optimize images and static assets
- Consider upgrading to VPS if shared hosting limits are reached
- Use PM2 alternative provided by Passenger (comes with cPanel)
- Monitor resource usage in cPanel dashboard

### MongoDB Setup for Production

#### Option 1: MongoDB Atlas (Recommended)

1. **Create account at** [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)

2. **Create a new cluster** (free tier available)

3. **Configure database access:**
   - Create a database user with username and password
   - Add your server's IP address to the IP whitelist (or 0.0.0.0/0 for all)

4. **Get connection string:**
   - Click "Connect" → "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your database user password
   - Replace `<dbname>` with `ai4edu_database`

5. **Set MONGO_URI environment variable** with the connection string

#### Option 2: Self-Hosted MongoDB

1. **Install MongoDB on your server:**

   ```bash
   sudo apt-get install -y mongodb-org
   sudo systemctl start mongod
   sudo systemctl enable mongod
   ```

2. **Configure authentication:**

   ```bash
   mongo
   use admin
   db.createUser({
     user: "adminuser",
     pwd: "strong_password",
     roles: [ { role: "userAdminAnyDatabase", db: "admin" } ]
   })
   ```

3. **Use connection string:**
   ```
   mongodb://adminuser:strong_password@localhost:27017/ai4edu_database?authSource=admin
   ```

### Database Seeding

After deployment, seed the database with test users:

```bash
npm run seed:users
```

### Security Checklist for Production

- [ ] Use strong `SESSION_SECRET` (32+ random characters)
- [ ] Enable HTTPS/SSL for your domain
- [ ] Set `NODE_ENV=production`
- [ ] Use MongoDB Atlas or secure your MongoDB instance
- [ ] Configure CORS to allow only your frontend domain
- [ ] Enable rate limiting (already configured)
- [ ] Keep dependencies updated: `npm audit fix`
- [ ] Never commit `.env` file to version control
- [ ] Use environment variables for all secrets
- [ ] Set up monitoring and error tracking (e.g., Sentry)
- [ ] Configure backups for MongoDB
- [ ] Use strong passwords for database users
- [ ] Restrict database access by IP address

### Post-Deployment Checks

1. **Test health endpoint:**

   ```bash
   curl https://your-domain.com/health
   ```

2. **Test database connection:**

   ```bash
   curl https://your-domain.com/api/v1/chatbot/health
   ```

3. **Test authentication:**

   ```bash
   curl -X POST https://your-domain.com/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username": "testuser", "password": "password"}'
   ```

4. **Monitor logs:**
   - Heroku: `heroku logs --tail`
   - PM2: `pm2 logs ai4edu-backend`
   - Render/DigitalOcean: Check dashboard logs

5. **Check MongoDB connection:**
   - Verify database is receiving connections
   - Check collection counts

### Monitoring and Maintenance

1. **Set up monitoring:**
   - Use PM2 monitoring: `pm2 monitor`
   - Set up uptime monitoring (e.g., UptimeRobot, Pingdom)
   - Configure error tracking (e.g., Sentry, LogRocket)

2. **Regular maintenance:**

   ```bash
   # Update dependencies
   npm update
   npm audit fix

   # Restart application
   pm2 restart ai4edu-backend

   # Check application status
   pm2 status
   ```

3. **Database backups:**
   - MongoDB Atlas: Enable automatic backups in dashboard
   - Self-hosted: Set up periodic `mongodump` backups

### Scaling Considerations

- **Horizontal scaling:** Use a load balancer with multiple instances
- **Database scaling:** Use MongoDB replica sets or sharding
- **Session management:** Consider using Redis for session storage
- **Caching:** Implement Redis caching for frequently accessed data
- **CDN:** Use a CDN for static assets

### Troubleshooting

**Application won't start:**

- Check logs for error messages
- Verify all environment variables are set
- Test MongoDB connection string

**Authentication not working:**

- Verify `SESSION_SECRET` is set
- Check `CLIENT_URL` and `SERVER_URL` are correct
- Ensure CORS is configured properly

**Database connection issues:**

- Verify MongoDB URI is correct
- Check IP whitelist in MongoDB Atlas
- Ensure database user has correct permissions

**High memory usage:**

- Monitor with `pm2 monit`
- Consider increasing server resources
- Check for memory leaks in logs

## License

MIT
