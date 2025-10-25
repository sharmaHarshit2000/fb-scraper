import express from "express";
import cors from "cors";
import { EventEmitter } from "events";
import { scrapeFacebookGroup } from "./scraper.js";
import dotenv from "dotenv";

// Load environment variables based on NODE_ENV
dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env",
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// Map to store ongoing jobs in memory
const jobs = new Map();

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Start a new scraping job asynchronously
app.post("/scrape", async (req, res) => {
  try {
    const { groupUrl, scrollLimit, cookies } = req.body;
    if (!groupUrl || typeof groupUrl !== "string") {
      return res.status(400).json({ error: "Valid groupUrl is required" });
    }

    const jobId = Date.now().toString();
    const emitter = new EventEmitter();
    jobs.set(jobId, { emitter, status: "running" });

    // Send jobId immediately so frontend can subscribe to updates
    res.json({ jobId });

    // Run the scraper in the background
    (async () => {
      try {
        console.log(`Starting scrape job ${jobId}: ${groupUrl}`);

        const progressCallback = (evt) => emitter.emit(evt.type || "progress", evt);

        const { csv, fileName } = await scrapeFacebookGroup(
          groupUrl,
          scrollLimit || 50,
          progressCallback,
          cookies || []
        );

        const job = jobs.get(jobId);
        if (job) {
          job.data = csv; // store CSV in memory
          job.fileName = fileName;
          job.status = "done";
        }

        emitter.emit("done", {
          downloadUrl: `/download/${jobId}`,
          file: fileName,
        });

        console.log(`Job ${jobId} completed. CSV ready (${fileName})`);
      } catch (err) {
        console.error(`Scraper failed for job ${jobId}:`, err);
        const job = jobs.get(jobId);
        if (job) job.status = "failed";
        emitter.emit("error", {
          message: err.message || "Scraper error",
          stack: err.stack,
          type: err.name,
        });
      }
    })();
  } catch (err) {
    console.error("POST /scrape error:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  }
});

// SSE endpoint for live job updates
app.get("/events/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).end("Unknown job ID");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.warn("SSE send error:", err.message);
    }
  };

  const keepAlive = setInterval(() => res.write(":keepalive\n\n"), 15000);
  send("info", { status: job.status });

  const onProgress = (d) => send("progress", d);
  const onLog = (d) => send("log", d);
  const onDone = (d) => send("done", d);
  const onError = (d) => send("error", d);

  job.emitter.on("progress", onProgress);
  job.emitter.on("log", onLog);
  job.emitter.once("done", onDone);
  job.emitter.once("error", onError);

  req.on("close", () => {
    clearInterval(keepAlive);
    job.emitter.off("progress", onProgress);
    job.emitter.off("log", onLog);
    job.emitter.off("done", onDone);
    job.emitter.off("error", onError);
  });
});

// Download CSV from memory
app.get("/download/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: "Unknown job" });
  if (!job.data) return res.status(400).json({ error: "Data not ready yet" });

  const fileName = job.fileName || `facebook_group_${jobId}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(job.data);

  // Clean up memory after 1 min
  setTimeout(() => {
    jobs.delete(jobId);
    console.log(`Cleaned memory for job ${jobId}`);
  }, 60_000);
});

// Cancel active job
app.post("/cancel/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: "Unknown job" });
  job.status = "canceled";
  job.emitter.emit("error", { message: "Canceled by user" });
  jobs.delete(jobId);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the app at: http://localhost:${PORT}`);
  console.log("Do NOT open index.html directly or use Live Server!");
  console.log("Always use the above URL so SSE/WebSocket works correctly.");
});
