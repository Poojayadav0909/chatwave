import "dotenv/config";
import express from "express";
import { createServer } from "http";
import cors from "cors";
import { Server } from "socket.io";

const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN, credentials: true },
});

const waitingQueue = [];
const rooms = new Map();
const userRooms = new Map();
const userData = new Map();

io.on("connection", (socket) => {
  const id = socket.id.substring(0, 6);
  console.log(`Connected: ${socket.id}`);

  userData.set(socket.id, { interests: [] });

  socket.on("find-partner", () => {
    const idx = waitingQueue.indexOf(socket.id);
    if (idx !== -1) waitingQueue.splice(idx, 1);

    const curRoom = userRooms.get(socket.id);
    if (curRoom) {
      const room = rooms.get(curRoom);
      if (room) {
        const pId = [...room].find((id) => id !== socket.id);
        if (pId) io.to(pId).emit("partner-left");
        socket.leave(curRoom);
        rooms.delete(curRoom);
        [...room].forEach((rid) => userRooms.delete(rid));
      }
      userRooms.delete(socket.id);
    }

    if (waitingQueue.length > 0) {
      const partnerId = waitingQueue.shift();
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (!partnerSocket) {
        waitingQueue.push(socket.id);
        socket.emit("waiting");
        return;
      }
      const roomId = `room_${socket.id}_${partnerId}`;
      socket.join(roomId);
      partnerSocket.join(roomId);
      rooms.set(roomId, new Set([socket.id, partnerId]));
      userRooms.set(socket.id, roomId);
      userRooms.set(partnerId, roomId);
      const initiator = Math.random() > 0.5;
      socket.emit("partner-found", { initiator });
      partnerSocket.emit("partner-found", { initiator: !initiator });
    } else {
      waitingQueue.push(socket.id);
      socket.emit("waiting");
    }
  });

  socket.on("next-partner", () => {
    const curRoom = userRooms.get(socket.id);
    if (curRoom) {
      const room = rooms.get(curRoom);
      if (room) {
        const pId = [...room].find((id) => id !== socket.id);
        if (pId) io.to(pId).emit("partner-left");
        socket.leave(curRoom);
        rooms.delete(curRoom);
        [...room].forEach((rid) => userRooms.delete(rid));
      }
      userRooms.delete(socket.id);
    }

    if (waitingQueue.length > 0) {
      const partnerId = waitingQueue.shift();
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (!partnerSocket) {
        waitingQueue.push(socket.id);
        socket.emit("waiting");
        return;
      }
      const roomId = `room_${socket.id}_${partnerId}`;
      socket.join(roomId);
      partnerSocket.join(roomId);
      rooms.set(roomId, new Set([socket.id, partnerId]));
      userRooms.set(socket.id, roomId);
      userRooms.set(partnerId, roomId);
      const initiator = Math.random() > 0.5;
      socket.emit("partner-found", { initiator });
      partnerSocket.emit("partner-found", { initiator: !initiator });
    } else {
      waitingQueue.push(socket.id);
      socket.emit("waiting");
    }
  });

  socket.on("signal", ({ data }) => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const partnerId = [...room].find((sid) => sid !== socket.id);
    if (partnerId) io.to(partnerId).emit("signal", { data });
  });

  socket.on("chat-message", (content) => {
    if (typeof content !== "string" || !content.trim()) return;
    if (content.length > 1000) content = content.slice(0, 1000);
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;
    io.to(roomId).emit("chat-message", {
      id: Date.now().toString(),
      content: content.trim(),
      sender: "Stranger",
      createdAt: new Date().toISOString(),
    });
  });

  socket.on("disconnect", () => {
    console.log(`Disconnected: ${socket.id}`);
    const idx = waitingQueue.indexOf(socket.id);
    if (idx !== -1) waitingQueue.splice(idx, 1);
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const pId = [...room].find((sid) => sid !== socket.id);
        if (pId) io.to(pId).emit("partner-left");
        socket.leave(roomId);
        rooms.delete(roomId);
        [...room].forEach((rid) => userRooms.delete(rid));
      }
    }
    userRooms.delete(socket.id);
    userData.delete(socket.id);
  });
});

if (!process.env.VERCEL) {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default function handler(req, res) {
  const upgrade = req.headers?.upgrade?.toLowerCase();
  if (upgrade === "websocket") {
    httpServer.emit("upgrade", req, req.socket, Buffer.alloc(0));
    return;
  }
  httpServer.emit("request", req, res);
}
