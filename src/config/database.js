const mongoose = require("mongoose");

// Enable buffering for production deployments (cPanel/Passenger)
// This allows queries to wait for connection instead of failing immediately
mongoose.set("bufferCommands", true);
mongoose.set("bufferTimeoutMS", 30000); // Wait up to 30 seconds for connection

async function connectDB() {
  // If already connected or connecting, return
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (mongoose.connection.readyState === 2) {
    return;
  }

  const uri = process.env.MONGO_URI;

  // Validate URI format
  if (!uri) {
    throw new Error("MONGO_URI environment variable is not set");
  }

  // Check if URI has proper scheme
  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new Error(
      "Invalid MongoDB URI scheme. Must start with 'mongodb://' or 'mongodb+srv://'",
    );
  }

  const opts = {
    serverSelectionTimeoutMS: 30000, // 30s primary
    socketTimeoutMS: 45000, // 45s inactivity
    connectTimeoutMS: 30000, // 30s to establish connection
    dbName: "ai4edu_database", // You can change this to your preferred database name
  };

  try {
    await mongoose.connect(uri, opts);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    throw err;
  }
}

/* --- Graceful shutdown --- */
async function gracefulExit() {
  try {
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error("❌ MongoDB shutdown error:", err.message);
    process.exit(1);
  }
}

process.on("SIGINT", gracefulExit).on("SIGTERM", gracefulExit);

module.exports = { mongoose, connectDB };
