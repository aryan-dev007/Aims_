require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const config = require("./config");
const routes = require("./routes");
const { testConnection } = require("./db");
const pgInventory = require("./pgInventory");

const app = express();
const server = http.createServer(app);
const socketOrigins = process.env.FRONTEND_ORIGINS
  ? process.env.FRONTEND_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080"];

// Make pgInventory available to route handlers
app.set("pgInventory", pgInventory);

// Socket.IO CORS for the dashboard origin(s)
const io = new Server(server, {
  cors: {
    origin: socketOrigins,
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 5e6, // 5 MB for base64 frames
});

// Make io available to routes
app.set("io", io);

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use("/api", routes);

// Unknown API routes -> JSON 404
app.use("/api", (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});


// Simple error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on("disconnect", (reason) => {
    console.log(`[WS] Client disconnected: ${socket.id} (${reason})`);
  });
});

// Track detector status
let lastDetectorPing = 0;
app.set("detectorPing", () => {
  lastDetectorPing = Date.now();
});
app.set("detectorStatus", () => {
  return Date.now() - lastDetectorPing < 10000; // active if pinged within 10s
});

server.listen(config.port, async () => {
  console.log(`Stock monitor backend listening on http://localhost:${config.port}`);
  console.log(`Socket.IO ready for real-time connections`);

  // Initialize PostgreSQL (non-blocking: existing JSON store still works if PG is down)
  const pgOk = await testConnection();
  if (pgOk) {
    console.log("[PG] PostgreSQL connected successfully");
    await pgInventory.loadCache();
  } else {
    console.warn("[PG] PostgreSQL unavailable — running with JSON store only");
  }
});
