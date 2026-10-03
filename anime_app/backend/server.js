require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ============================================================
// GOOGLE DRIVE AUTH
// ============================================================

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },

  scopes: [
    "https://www.googleapis.com/auth/drive.readonly",
  ],
});

const drive = google.drive({
  version: "v3",
  auth,
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Anime Video Streaming Backend is running",
  });
});

// ============================================================
// VIDEO STREAM
// ============================================================

app.get("/api/videos/:fileId/stream", async (req, res) => {
  try {
    const fileId = req.params.fileId;

    if (!fileId) {
      return res.status(400).json({
        success: false,
        message: "File ID is required",
      });
    }

    console.log("Streaming file:", fileId);

    // ========================================================
    // GET FILE INFORMATION
    // ========================================================

    const fileInfo = await drive.files.get({
      fileId: fileId,
      fields: "id,name,size,mimeType",
    });

    const file = fileInfo.data;

    const fileSize = Number(file.size || 0);
    const mimeType = file.mimeType || "video/mp4";

    console.log("File:", file.name);
    console.log("Size:", fileSize);
    console.log("Type:", mimeType);

    // ========================================================
    // RANGE REQUEST
    // ========================================================

    const range = req.headers.range;

    // --------------------------------------------------------
    // NO RANGE
    // --------------------------------------------------------

    if (!range) {
      const response = await drive.files.get(
        {
          fileId: fileId,
          alt: "media",
        },
        {
          responseType: "stream",
        }
      );

      res.status(200);

      res.setHeader(
        "Content-Type",
        mimeType
      );

      res.setHeader(
        "Content-Length",
        fileSize
      );

      res.setHeader(
        "Accept-Ranges",
        "bytes"
      );

      response.data.pipe(res);

      return;
    }

    // ========================================================
    // PARSE RANGE
    // ========================================================

    const parts = range.replace(/bytes=/, "").split("-");

    const start = parseInt(parts[0], 10);

    let end;

    if (parts.length > 1) {
      end = parseInt(parts[1], 10);
    } else {
      end = fileSize - 1;
    }

    // ========================================================
    // VALIDATE RANGE
    // ========================================================

    if (
      isNaN(start) ||
      isNaN(end) ||
      start < 0 ||
      end >= fileSize ||
      start > end
    ) {
      res.status(416);

      res.setHeader(
        "Content-Range",
        `bytes */${fileSize}`
      );

      return res.end();
    }

    const chunkSize = end - start + 1;

    console.log(
      `Range: ${start}-${end}/${fileSize}`
    );

    // ========================================================
    // GOOGLE DRIVE RANGE REQUEST
    // ========================================================

    const response = await drive.files.get(
      {
        fileId: fileId,
        alt: "media",
      },
      {
        responseType: "stream",

        headers: {
          Range: `bytes=${start}-${end}`,
        },
      }
    );

    // ========================================================
    // RESPONSE HEADERS
    // ========================================================

    res.status(206);

    res.setHeader(
      "Content-Type",
      mimeType
    );

    res.setHeader(
      "Content-Length",
      chunkSize
    );

    res.setHeader(
      "Content-Range",
      `bytes ${start}-${end}/${fileSize}`
    );

    res.setHeader(
      "Accept-Ranges",
      "bytes"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache"
    );

    // ========================================================
    // STREAM TO FLUTTER
    // ========================================================

    response.data.on("error", (error) => {
      console.error(
        "Google Drive stream error:",
        error
      );

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "Video streaming failed",
        });
      } else {
        res.destroy(error);
      }
    });

    response.data.pipe(res);

  } catch (error) {

    console.error(
      "VIDEO STREAM ERROR:",
      error.response?.data || error.message
    );

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Unable to stream video",
        error: error.message,
      });
    }
  }
});

// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Video backend running on port ${PORT}`
    );
  }
);