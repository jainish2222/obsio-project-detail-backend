import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

dotenv.config();
const requiredEnv = ["AWS_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY", "AWS_SECRET_KEY"];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ Missing environment variable: ${key}`);
    process.exit(1);
  }
});

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const listObjects = async ({ Bucket, Prefix = "", MaxKeys = 1000, ContinuationToken = undefined }) => {
  try {
    const command = new ListObjectsV2Command({ Bucket, Prefix, MaxKeys, ContinuationToken });
    const data = await s3.send(command);
    return data;
  } catch (err) {
    console.error("S3 Error:", err);
    throw err;
  }
};

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Too many requests, please try again later." },
});
app.use("/api/", apiLimiter);

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// -------------------
// CACHE SETUP
// -------------------
let cachedImages = [];
let cachedFolders = {};

const refreshImages = async () => {
  try {
    const data = await listObjects({ Bucket: process.env.AWS_BUCKET });
    cachedImages = data.Contents?.map((file) => ({
      key: file.Key,
      url: `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${file.Key}`,
    })) || [];
    console.log(`✅ Cached ${cachedImages.length} images`);
  } catch (err) {
    console.error("Failed to refresh S3 images:", err);
  }
};

const refreshFolder = async (folder) => {
  try {
    const data = await listObjects({ Bucket: process.env.AWS_BUCKET, Prefix: `${folder}/` });
    cachedFolders[folder] = data.Contents?.map((file) => ({
      key: file.Key,
      url: `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${file.Key}`,
    })) || [];
    console.log(`✅ Cached ${cachedFolders[folder]?.length || 0} images for folder "${folder}"`);
  } catch (err) {
    console.error(`Failed to refresh folder "${folder}":`, err);
  }
};

// Initial cache
refreshImages();

// Refresh cache every 45 seconds
setInterval(refreshImages, 45 * 1000);
setInterval(() => {
  Object.keys(cachedFolders).forEach(folder => refreshFolder(folder));
}, 45 * 1000);

// -------------------
// ROUTES
// -------------------
app.get("/", (req, res) => res.json({ message: "S3 Image Server is Running..." }));

// Return cached images instantly
app.get("/api/images", (req, res) => {
  res.json(cachedImages);
});

// Return cached folder images, fetch in background if not present
app.get(/^\/api\/images\/(.+)$/, asyncHandler(async (req, res) => {
  const folder = req.params[0];

  if (!cachedFolders[folder]) {
    // Fetch in background but respond immediately
    refreshFolder(folder);
    return res.json([]); // return empty array first time
  }

  res.json(cachedFolders[folder]);
}));

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
