const TLS = true;
const DEBUG = true;
const ENDPOINT = "/signaling";
const INACTIVE_TIMEOUT = 60 * 60 * 1000; // 1 hour

import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";

// -----------------------------------
// signaling handler
// -----------------------------------
function signalingHandler(server) {
  const wsServer = new WebSocketServer({ server, path: ENDPOINT });
  const wsCurrentClients = new Map();

  const getCurrentSenders = () =>
    Array.from(wsCurrentClients.values())
      .filter((client) => client.protocol === "sender")
      .map((client) => client.sessionId);

  const notifySenderEntries = () => {
    const senders = getCurrentSenders();

    Array.from(wsCurrentClients.entries())
      .filter(([_, client]) => client.protocol === "receiver")
      .forEach(([receiverWs]) => {
        receiverWs.send(JSON.stringify({ type: 201, senders })); // CHANGE_SENDER_ENTRIES: 201
      });
  };

  const sendMessage = (protocol, sessionId, text) => {
    const [target] =
      Array.from(wsCurrentClients.entries()).find(
        ([_, client]) =>
          client.protocol === protocol && client.sessionId === sessionId
      ) || [];

    if (target) {
      target.send(text);
      return true;
    }

    return false;
  };

  wsServer.on("connection", (wsClient, request) => {
    const coming = request.headers["sec-websocket-protocol"]?.toLowerCase();

    if (!["receiver", "sender"].includes(coming)) {
      wsClient.close();
      return;
    }

    const sessionId = nanoid(8);
    wsCurrentClients.set(wsClient, {
      sessionId,
      protocol: coming,
      lastActive: Date.now(),
    });
    console.log(`connected ${coming} sessionId: ${sessionId}`);

    if (coming === "sender") {
      notifySenderEntries();
      wsClient.send(JSON.stringify({ type: 100, sessionId })); // SESSION_ID_ISSUANCE: 100
    }

    if (coming === "receiver") {
      const senders = getCurrentSenders();
      wsClient.send(JSON.stringify({ type: 200, sessionId, senders })); // SESSION_ID_ISSUANCE: 200
    }

    wsClient.on("message", (message) => {
      wsCurrentClients.get(wsClient).lastActive = Date.now();

      try {
        let data = JSON.parse(message);

        if (DEBUG) console.log(`\n Incoming message fom ${coming} :`, data);

        if (
          sendMessage(
            coming === "receiver" ? "sender" : "receiver",
            coming === "receiver" ? data.ws1Id : data.ws2Id,
            message.toString("utf-8")
          )
        ) {
          console.log(
            coming === "receiver"
              ? "relay to ws2 ---> ws1"
              : "relay to ws1 ---> ws2"
          );
          return;
        }
      } catch (err) {
        console.error(`Error:${err.message} \nmessage:${message}`);
        wsClient.send(
          JSON.stringify({
            type: coming === "sender" ? 109 : 209,
            message: err.message,
          })
        ); // SYSTEM_ERROR: 109 / 209

        return;
      }

      wsClient.send(
        JSON.stringify({
          type: coming === "sender" ? 109 : 209,
          message: "!!! sending failed",
        })
      ); // SYSTEM_ERROR: 109 / 209
    });

    wsClient.on("close", () => {
      console.log(`disconnected ${coming} sessionId: ${sessionId}`);
      if (coming === "sender") {
        notifySenderEntries();
      }
      wsCurrentClients.delete(wsClient);
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [ws, client] of wsCurrentClients) {
      if (now - client.lastActive > INACTIVE_TIMEOUT) {
        ws.terminate();
        wsCurrentClients.delete(ws);
        console.log(`Session ${client.sessionId} removed due to inactivity.`);
      }
    }
  }, 60 * 1000);
}

// -----------------------------------
// web handler
// -----------------------------------
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_EXTENSIONS = {
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "application/javascript",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

function allowPathname(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  let pathname = decodeURIComponent(requestUrl.pathname);

  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return null;
  }

  if (pathname.endsWith("/")) {
    pathname += "index.html";
  }

  const sanitizedPath = path
    .normalize(pathname)
    .replace(/^(\.\.(\/|\\|$))+/, "");
  const distPath = path.join(__dirname, "dist");
  const resolvedPath = path.join(distPath, sanitizedPath);

  if (!resolvedPath.startsWith(distPath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return null;
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!VALID_EXTENSIONS[ext]) {
    response.writeHead(403);
    response.end("Forbidden");
    return null;
  }

  return sanitizedPath;
}

function readFile(pathname, response) {
  pathname = path.join(__dirname, "dist", pathname);
  fs.access(pathname, fs.constants.F_OK, (err) => {
    if (err) {
      response.writeHead(404);
      response.end("Not Found: " + pathname);
      return;
    }

    const ext = path.extname(pathname).toLowerCase();
    const fileStream = fs.createReadStream(pathname);

    response.writeHead(200, { "Content-Type": VALID_EXTENSIONS[ext] });
    fileStream.pipe(response);
    fileStream.on("error", (err) => {
      console.error("File read error:", err);
      if (!response.headersSent) {
        response.writeHead(500);
        response.end("Internal Server Error");
      }
    });
  });
}

const webHandler = async (request, response) => {
  try {
    let pathname = allowPathname(request, response);
    readFile(pathname, response);
  } catch ({ stack }) {
    console.error(stack);
  }
};

// -----------------------------------
// create run server
// -----------------------------------
import os from "os";

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  const ipv4Addresses = [];

  for (const iface of Object.values(interfaces)) {
    for (const details of iface) {
      if (details.family === "IPv4" && !details.internal) {
        ipv4Addresses.push(details.address);
      }
    }
  }

  return ipv4Addresses.length > 0 ? ipv4Addresses[0] : "localhost";
}

import http from "http";
import https from "https";
import fs from "fs";

const options = {
  key: fs.readFileSync("server-key.pem"),
  cert: fs.readFileSync("server-cert.pem"),
  // ca: fs.readFileSync('server-ca-cert.pem')
};

const server = TLS
  ? https.createServer(options, webHandler)
  : http.createServer(webHandler);

signalingHandler(server);

server.listen(TLS ? 443 : 80, () => {
  console.log(
    `Server is running at: ${TLS ? "https" : "http"}://${getLocalIPv4()}`
  );
});
