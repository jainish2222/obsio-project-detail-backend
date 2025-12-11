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
app.set('trust proxy', 1); // Trust the first proxy (e.g., Render, Nginx)
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" })); // Allow specific origins in production
app.use(express.json());


const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Too many requests, please try again later." },
});
app.use("/api/", apiLimiter);

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/", (req, res) => res.json({ message: "S3 Image Server is Running..." }));

app.get("/api/images", asyncHandler(async (req, res) => {
  const data = await listObjects({ Bucket: process.env.AWS_BUCKET });
  const images = data.Contents?.map((file) => ({
    key: file.Key,
    url: `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${file.Key}`,
  })) || [];
  res.json(images);
}));


app.get(/^\/api\/images\/(.+)$/, asyncHandler(async (req, res) => {
  const folderPath = req.params[0];
  const data = await listObjects({
    Bucket: process.env.AWS_BUCKET,
    Prefix: `${folderPath}/`,
  });

  const images = data.Contents?.map((file) => ({
    key: file.Key,
    url: `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${file.Key}`,
  })) || [];

  res.json(images);
}));

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
