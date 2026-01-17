const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        activeRooms: Object.keys(rooms).length
    });
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for now (dev)
        methods: ["GET", "POST"]
    }
});

// --- State ---
const rooms = {};
// Structure:
// rooms[roomId] = {
//   id: roomId,
//   queue: [], // Array of Song Objects
//   playback: {
//     isPlaying: false,
//     currentSong: null,
//     timestamp: 0,
//     lastUpdated: Date.now()
//   },
//   users: [] // list of socket IDs
// }

// --- Helpers ---
const getRoom = (roomId) => {
    if (!rooms[roomId]) {
        rooms[roomId] = {
            id: roomId,
            queue: [],
            history: [],
            playback: {
                isPlaying: false,
                currentSong: null,
                timestamp: 0,
                lastUpdated: Date.now(),
                source: 'master' // [NEW] Default to master when empty
            },
            users: [],
            masterId: null // [NEW] Master Role
        };
        console.log(`Room created: ${roomId}`);
    }
    return rooms[roomId];
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_room', ({ roomId, username }) => {
        socket.join(roomId);
        const room = getRoom(roomId);

        // Remove existing if any (re-join)
        const existingUserIndex = room.users.findIndex(u => u.id === socket.id);
        if (existingUserIndex !== -1) {
            room.users.splice(existingUserIndex, 1);
        }

        room.users.push({ id: socket.id, name: username || 'Anonymous' });

        // Assign Master if none exists
        if (!room.masterId) {
            room.masterId = socket.id;
        }

        // Send current state to new user
        socket.emit('sync_state', {
            queue: room.queue,
            history: room.history,
            playback: room.playback,
            users: room.users,
            masterId: room.masterId
        });

        // Notify others
        io.to(roomId).emit('users_update', room.users);
        io.to(roomId).emit('master_update', room.masterId);

        console.log(`User ${socket.id} (${username}) joined room ${roomId}`);
    });

    socket.on('transfer_master', ({ roomId, targetId }) => {
        const room = getRoom(roomId);
        // Only current master can transfer
        if (room.masterId === socket.id) {
            // Verify target exists
            if (room.users.find(u => u.id === targetId)) {
                room.masterId = targetId;
                io.to(roomId).emit('master_update', room.masterId);
                console.log(`Room ${roomId}: Master transferred to ${targetId}`);
            }
        }
    });

    // [NEW] Master State Update (Relay)
    socket.on('master_state_update', ({ roomId, state }) => {
        const room = getRoom(roomId);
        // console.log(`Debug connection: Socket ${socket.id} claiming to be Master of ${roomId}. Actual Master: ${room.masterId}`);
        // Only accept if from Master
        if (room.masterId === socket.id) {
            // console.log(`[${Date.now()}] Master Update from ${socket.id} in room ${roomId}: TS=${state.playback.timestamp}`);
            // [Fix] Update Server-side Single Source of Truth
            // This prevents clients receiving empty state on reconnect/join
            room.queue = state.queue || [];
            room.history = state.history || [];
            room.playback = state.playback || room.playback;

            // Relay to everyone else in the room
            socket.to(roomId).emit('sync_state', state);
            // console.log(`Relayed sync_state to room ${roomId}`);
        } else {
            console.warn(`Blocked spoofed master update from ${socket.id} in room ${roomId} (Master is ${room.masterId})`);
        }
    });

    // [NEW] Remote Action Relay (add, play, pause, next, previous, seek)
    // Slaves send this -> Server relays to Master -> Master executes -> Master updates state
    socket.on('remote_action', ({ roomId, action, payload }) => {
        const room = getRoom(roomId);
        if (room.masterId) {
            // Forward to Master
            io.to(room.masterId).emit('remote_action_request', {
                action,
                payload,
                requesterId: socket.id
            });
            // console.log(`Room ${roomId}: Relaying action '${action}' to Master (${room.masterId})`);
        } else {
            console.log(`Room ${roomId}: Action '${action}' ignored (No Master)`);
        }
    });

    socket.on('leave_room', ({ roomId }) => {
        const room = getRoom(roomId);

        // Remove user
        const userIndex = room.users.findIndex(u => u.id === socket.id);
        if (userIndex !== -1) {
            room.users.splice(userIndex, 1);
            socket.leave(roomId);
            console.log(`User ${socket.id} left room ${roomId}`);
        }

        // Handle Master Leaving
        if (room.masterId === socket.id) {
            room.masterId = null;

            // Assign new master if users remain
            if (room.users.length > 0) {
                room.masterId = room.users[0].id;
                console.log(`Room ${roomId}: Master reassigned to ${room.masterId}`);
            } else {
                // Reset state only if room is empty
                room.queue = [];
                room.playback = { isPlaying: false, currentSong: null, timestamp: 0, lastUpdated: Date.now(), source: 'master' };
                console.log(`Room ${roomId}: Master left. Room empty. Resetting room state.`);
            }
        }

        // Notify remaining users
        io.to(roomId).emit('users_update', room.users);
        io.to(roomId).emit('master_update', room.masterId);
        // If master left, sync empty state
        if (!room.masterId) {
            io.to(roomId).emit('sync_state', {
                queue: room.queue,
                history: room.history,
                playback: room.playback,
                users: room.users,
                masterId: room.masterId
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Find room user was in and remove them
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const index = room.users.findIndex(u => u.id === socket.id);
            if (index !== -1) {
                const wasMaster = room.masterId === socket.id;
                room.users.splice(index, 1);

                // Reassign Master if needed
                if (wasMaster) {
                    if (room.users.length > 0) {
                        room.masterId = room.users[0].id;
                    } else {
                        room.masterId = null;
                    }
                    io.to(roomId).emit('master_update', room.masterId);
                }

                io.to(roomId).emit('users_update', room.users);
                console.log(`User removed from room ${roomId}`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Coordinator Server running on port ${PORT}`);
});
