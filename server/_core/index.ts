import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  // Serve local storage files in development (when S3 is not configured)
  if (process.env.NODE_ENV === "development") {
    app.use("/storage", express.static(".local-storage"));
  }
  
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  
  // Streaming chat endpoint (SSE)
  app.post("/api/chat/stream", async (req, res) => {
    try {
      const { fileId, threadId, message, systemPrompt } = req.body;
      
      if (!fileId || !threadId || !message) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }
      
      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      
      const { getIndexByFileId, getPdfFileById, addMessage, getThreadSummary, estimateMessageTokens } = await import("../db");
      const { retrieveContext } = await import("../retrieval");
      const { buildPrompt, streamResponse } = await import("../streaming");
      
      console.log(`[Stream] Starting stream for file ${fileId}, thread ${threadId}`);
      const requestStart = Date.now();
      
      // Check index status
      const index = await getIndexByFileId(fileId);
      if (!index || index.status !== "READY") {
        res.write(`data: ${JSON.stringify({ type: "error", error: "PDF not indexed yet. Please wait for indexing to complete." })}\n\n`);
        res.end();
        return;
      }
      
      // Get PDF file info
      const file = await getPdfFileById(fileId);
      if (!file) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "PDF file not found" })}\n\n`);
        res.end();
        return;
      }
      
      // Save user message
      await addMessage({
        threadId,
        role: "user",
        content: message,
        tokenCount: estimateMessageTokens(message),
      });
      
      // Retrieve context
      const retrievalStart = Date.now();
      const { chunks, totalTokens, error: retrievalError } = await retrieveContext(fileId, message);
      const retrievalMs = Date.now() - retrievalStart;
      
      if (retrievalError) {
        res.write(`data: ${JSON.stringify({ type: "error", error: retrievalError })}\n\n`);
        res.end();
        return;
      }
      
      // Get thread summary
      const threadSummary = await getThreadSummary(threadId);
      
      // Build prompt
      const { messages, citations } = buildPrompt(
        systemPrompt || "",
        { fileName: file.fileName },
        threadSummary,
        message,
        chunks
      );
      
      // Send retrieval timing
      res.write(`data: ${JSON.stringify({ type: "timing", timing: { retrievalMs, contextTokens: totalTokens } })}\n\n`);
      
      // Stream response
      let fullResponse = "";
      let firstTokenMs = 0;
      
      for await (const chunk of streamResponse(messages)) {
        if (chunk.type === "token") {
          fullResponse += chunk.content || "";
          res.write(`data: ${JSON.stringify({ type: "token", content: chunk.content })}\n\n`);
        } else if (chunk.type === "timing") {
          if (chunk.timing.firstTokenMs) {
            firstTokenMs = chunk.timing.firstTokenMs;
          }
        }
      }
      
      // Save assistant message
      await addMessage({
        threadId,
        role: "assistant",
        content: fullResponse,
        tokenCount: estimateMessageTokens(fullResponse),
        citations: JSON.stringify(citations),
      });
      
      // Send final data
      const totalMs = Date.now() - requestStart;
      res.write(`data: ${JSON.stringify({
        type: "done",
        citations,
        timing: { totalMs, firstTokenMs, retrievalMs }
      })}\n\n`);
      
      console.log(`[Stream] Completed in ${totalMs}ms (first token: ${firstTokenMs}ms, retrieval: ${retrievalMs}ms)`);
      
      res.end();
    } catch (error) {
      console.error("[Stream] Error:", error);
      res.write(`data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) })}\n\n`);
      res.end();
    }
  });
  
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
