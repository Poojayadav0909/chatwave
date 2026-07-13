import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const waitingQueue = [];
const userRooms = new Map();
const rooms = new Map();
const userSockets = new Map();

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);
  userSockets.set(socket.id, socket);

  socket.on("find-partner", () => {
    removeFromQueue(socket.id);
    leaveRoom(socket.id);

    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      const roomId = `room_${socket.id}_${partner.id}`;

      socket.join(roomId);
      partner.join(roomId);

      rooms.set(roomId, new Set([socket.id, partner.id]));
      userRooms.set(socket.id, roomId);
      userRooms.set(partner.id, roomId);

      const initiator = Math.random() > 0.5;
      socket.emit("partner-found", { initiator });
      partner.emit("partner-found", { initiator: !initiator });
    } else {
      waitingQueue.push(socket);
      socket.emit("waiting");
    }
  });

  socket.on("signal", ({ data }) => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const partnerId = [...room].find((id) => id !== socket.id);
    if (partnerId) io.to(partnerId).emit("signal", { data });
  });

  socket.on("next-partner", () => {
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const partnerId = [...room].find((id) => id !== socket.id);
        if (partnerId) io.to(partnerId).emit("partner-left");
        socket.leave(roomId);
        rooms.delete(roomId);
        [...room].forEach((id) => userRooms.delete(id));
      }
    }
    userRooms.delete(socket.id);

    if (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      const newRoomId = `room_${socket.id}_${partner.id}`;
      socket.join(newRoomId);
      partner.join(newRoomId);
      rooms.set(newRoomId, new Set([socket.id, partner.id]));
      userRooms.set(socket.id, newRoomId);
      userRooms.set(partner.id, newRoomId);
      const initiator = Math.random() > 0.5;
      socket.emit("partner-found", { initiator });
      partner.emit("partner-found", { initiator: !initiator });
    } else {
      waitingQueue.push(socket);
      socket.emit("waiting");
    }
  });

  socket.on("disconnect", () => {
    console.log(`Disconnected: ${socket.id}`);
    removeFromQueue(socket.id);
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const partnerId = [...room].find((id) => id !== socket.id);
        if (partnerId && userSockets.has(partnerId)) {
          io.to(partnerId).emit("partner-left");
        }
        [...room].forEach((id) => userRooms.delete(id));
        rooms.delete(roomId);
      }
    }
    userRooms.delete(socket.id);
    userSockets.delete(socket.id);
  });
});

function removeFromQueue(socketId) {
  const idx = waitingQueue.findIndex((s) => s.id === socketId);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

function leaveRoom(socketId) {
  const roomId = userRooms.get(socketId);
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (room) {
    const s = userSockets.get(socketId);
    if (s) s.leave(roomId);
    room.delete(socketId);
    if (room.size === 0) rooms.delete(roomId);
  }
  userRooms.delete(socketId);
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
