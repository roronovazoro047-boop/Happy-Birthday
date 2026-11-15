import express from "express";
import multer from "multer";
import {
  getSlotPhotos,
  uploadSlotPhoto,
  normalizeSlot,
  isSupabaseConfigured,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
} from "./supabase.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype.toLowerCase();
    if (ALLOWED_MIME_TYPES.includes(mime)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image type: ${file.mimetype}. Allowed types: JPG, PNG, WEBP, GIF, HEIC.`));
    }
  },
});

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      supabaseConfigured: isSupabaseConfigured(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/photos", async (_req, res) => {
    try {
      const photos = await getSlotPhotos();
      res.json({ success: true, configured: isSupabaseConfigured(), photos });
    } catch (err: any) {
      console.error("[API] Error fetching photos:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Failed to fetch photos",
        photos: { polaroid: null, "special-memory": null },
      });
    }
  });

  app.post(
    "/api/photos/upload",
    (req, res, next) => {
      upload.single("image")(req, res, (err) => {
        if (err) {
          if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
              success: false,
              error: "Image file is too large. Maximum size is 10MB.",
            });
          }
          return res.status(400).json({ success: false, error: err.message || "Upload error" });
        }
        next();
      });
    },
    async (req, res) => {
      try {
        const slotRaw = req.body.slot || req.query.slot;
        const slot = normalizeSlot(slotRaw);

        if (!slot) {
          return res.status(400).json({
            success: false,
            error: "Invalid slot identifier. Expected 'polaroid' or 'special-memory'.",
          });
        }

        let buffer: Buffer | null = null;
        let mimeType = "image/png";
        let originalName = "photo.png";

        if (req.file) {
          buffer = req.file.buffer;
          mimeType = req.file.mimetype.toLowerCase();
          originalName = req.file.originalname;
        } else if (req.body.data) {
          const dataStr: string = req.body.data;
          const matches = dataStr.match(/^data:([A-Za-z0-9-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            mimeType = matches[1].toLowerCase();
            buffer = Buffer.from(matches[2], "base64");
          } else {
            buffer = Buffer.from(dataStr, "base64");
          }
          originalName = req.body.name || `photo-${Date.now()}.${mimeType.split("/")[1] || "png"}`;
        }

        if (!buffer || buffer.length === 0) {
          return res.status(400).json({
            success: false,
            error: "No image file provided. Please choose a photo to upload.",
          });
        }

        if (buffer.length > MAX_FILE_SIZE) {
          return res.status(400).json({ success: false, error: "Image file exceeds the 10MB limit." });
        }

        if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
          return res.status(400).json({
            success: false,
            error: `Unsupported image format: ${mimeType}. Please upload a JPG, PNG, WEBP, or GIF image.`,
          });
        }

        const result = await uploadSlotPhoto(slot, buffer, mimeType, originalName);
        res.json({ success: true, slot, url: result.url });
      } catch (err: any) {
        console.error("[API] Error in /api/photos/upload:", err);
        res.status(500).json({
          success: false,
          error: err.message || "Failed to upload photo to cloud storage.",
        });
      }
    }
  );

  return app;
}
