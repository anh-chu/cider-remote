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
    },
    pingInterval: 5000,   // Ping every 5 seconds
    pingTimeout: 10000,   // 10 second timeout (allows 2 missed pings)
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
//     lastUpdated: Date.now(),
//     seq: 0 // [NEW] Sequence number for ordering
//   },
//   users: [], // list of socket IDs
//   masterEpoch: 0 // [NEW] Increments when master changes
//   masterGraceTimeout: null, // [NEW] Timeout for master grace period
//   pendingMasterId: null // [NEW] Tracks master ID during grace period
// }

// --- Client Clock Offsets ---
// Maps socket.id -> { offset: number, rtt: number, samples: number[] }
const clientClocks = new Map();

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
                source: 'master',
                seq: 0, // [NEW] Sequence number for ordering
                lastSeekTimestamp: 0
            },
            users: [],
            masterId: null,
            masterEpoch: 0, // [NEW] Increments when master changes
            masterGraceTimeout: null, // [NEW] Timeout for master grace period
            pendingMasterId: null // [NEW] Tracks master ID during grace period
        };
        console.log(`Room created: ${roomId}`);
    }
    return rooms[roomId];
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // --- Time Sync Protocol ---
    // Client sends ping with local time, server responds with server time
    // Client calculates offset = (serverTime - clientTime) - (rtt / 2)
    socket.on('time_sync_request', ({ clientTime, sampleIndex }) => {
        const serverTime = Date.now();
        socket.emit('time_sync_response', {
            clientTime,
            serverTime,
            sampleIndex
        });
    });

    // Client reports its calculated offset (for logging/debugging)
    socket.on('time_sync_report', ({ offset, rtt }) => {
        clientClocks.set(socket.id, {
            offset,
            rtt,
            lastSync: Date.now()
        });
        // console.log(`Clock sync for ${socket.id}: offset=${offset}ms, rtt=${rtt}ms`);
    });

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
            room.masterEpoch += 1; // [NEW] Increment epoch on master assignment
        }

        // Send current state to new user (including masterEpoch)
        socket.emit('sync_state', {
            queue: room.queue,
            history: room.history,
            playback: room.playback,
            users: room.users,
            masterId: room.masterId,
            masterEpoch: room.masterEpoch,
            serverTime: Date.now() // [NEW] Include server time for immediate sync
        });

        // Notify others
        io.to(roomId).emit('users_update', room.users);
        io.to(roomId).emit('master_update', {
            masterId: room.masterId,
            masterEpoch: room.masterEpoch
        });

        console.log(`User ${socket.id} (${username}) joined room ${roomId}`);
    });

    // [NEW] Master Rejoin Handler (within grace period)
    socket.on('rejoin_room', ({ roomId, username, previousSocketId }) => {
        socket.join(roomId);
        const room = getRoom(roomId);

        // Check if this is the previous master rejoining within grace period
        if (room.pendingMasterId === previousSocketId && room.masterGraceTimeout !== null) {
            // Clear the grace timeout
            clearTimeout(room.masterGraceTimeout);
            room.masterGraceTimeout = null;

            // Restore as master with new socket ID
            room.masterId = socket.id;
            room.pendingMasterId = null;

            console.log(`Master reconnected within grace period: ${socket.id} (was ${previousSocketId}) in room ${roomId}`);

            // Restore user in list (replace old socket ID entry if exists)
            const oldMasterIndex = room.users.findIndex(u => u.id === previousSocketId);
            if (oldMasterIndex !== -1) {
                room.users.splice(oldMasterIndex, 1);
            }
            const existingIndex = room.users.findIndex(u => u.id === socket.id);
            if (existingIndex !== -1) {
                room.users.splice(existingIndex, 1);
            }
            room.users.push({ id: socket.id, name: username || 'Anonymous' });

            // Send current state to master
            socket.emit('sync_state', {
                queue: room.queue,
                history: room.history,
                playback: room.playback,
                users: room.users,
                masterId: room.masterId,
                masterEpoch: room.masterEpoch,
                serverTime: Date.now()
            });

            // Notify all users of state restoration
            io.to(roomId).emit('users_update', room.users);
            io.to(roomId).emit('master_update', {
                masterId: room.masterId,
                masterEpoch: room.masterEpoch
            });
        } else {
            // Grace period expired or not in grace period, treat as normal join
            socket.emit('join_room', { roomId, username });
        }
    });

    socket.on('transfer_master', ({ roomId, targetId }) => {
        const room = getRoom(roomId);
        // Only current master can transfer
        if (room.masterId === socket.id) {
            // Verify target exists
            if (room.users.find(u => u.id === targetId)) {
                room.masterId = targetId;
                room.masterEpoch += 1; // [NEW] Increment epoch on master transfer
                io.to(roomId).emit('master_update', {
                    masterId: room.masterId,
                    masterEpoch: room.masterEpoch
                });
                console.log(`Room ${roomId}: Master transferred to ${targetId} (epoch: ${room.masterEpoch})`);
            }
        }
    });

    // [NEW] Master State Update (Relay)
    socket.on('master_state_update', ({ roomId, state, masterEpoch }) => {
        const room = getRoom(roomId);
        // console.log(`Debug connection: Socket ${socket.id} claiming to be Master of ${roomId}. Actual Master: ${room.masterId}`);

        // Only accept if from Master AND epoch matches (prevents stale updates)
        if (room.masterId === socket.id) {
            // [NEW] Validate epoch if provided (optional for backwards compatibility)
            if (masterEpoch !== undefined && masterEpoch !== room.masterEpoch) {
                console.warn(`Blocked stale master update from ${socket.id} (epoch mismatch: ${masterEpoch} vs ${room.masterEpoch})`);
                return;
            }

            // console.log(`[${Date.now()}] Master Update from ${socket.id} in room ${roomId}: TS=${state.playback.timestamp}`);
            // [Fix] Update Server-side Single Source of Truth
            // This prevents clients receiving empty state on reconnect/join
            room.queue = state.queue || [];
            room.history = state.history || [];

            // [NEW] Increment sequence number on each accepted state update
            room.playback.seq = (room.playback.seq || 0) + 1;

            // Merge playback state with server's seq
            room.playback = {
                ...state.playback,
                seq: room.playback.seq,
                serverTime: Date.now() // [NEW] Authoritative server timestamp
            };

            // Relay to everyone else in the room with server time and seq
            socket.to(roomId).emit('sync_state', {
                ...state,
                playback: room.playback,
                masterEpoch: room.masterEpoch,
                serverTime: Date.now()
            });
            // console.log(`Relayed sync_state to room ${roomId} (seq: ${room.playback.seq})`);
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
                // Clear any existing grace timeout
                if (room.masterGraceTimeout) {
                    clearTimeout(room.masterGraceTimeout);
                    room.masterGraceTimeout = null;
                }
                room.pendingMasterId = null;

                room.masterId = room.users[0].id;
                room.masterEpoch += 1; // [NEW] Increment epoch on master reassignment
                console.log(`Room ${roomId}: Master reassigned to ${room.masterId} (epoch: ${room.masterEpoch})`);

                // Pause music for all remaining users when master leaves
                io.to(roomId).emit('master_paused');
            } else {
                // Room is empty, destroy it and clear grace timeout
                if (room.masterGraceTimeout) {
                    clearTimeout(room.masterGraceTimeout);
                    room.masterGraceTimeout = null;
                }
                delete rooms[roomId];
                console.log(`Room ${roomId}: Master left. Room destroyed (empty).`);
            }
        }

        // Notify remaining users only if room still exists
        if (rooms[roomId]) {
            io.to(roomId).emit('users_update', room.users);
            io.to(roomId).emit('master_update', {
                masterId: room.masterId,
                masterEpoch: room.masterEpoch
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Clean up clock data
        clientClocks.delete(socket.id);

        // Find room user was in and remove them
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const index = room.users.findIndex(u => u.id === socket.id);
            if (index !== -1) {
                const wasMaster = room.masterId === socket.id;
                room.users.splice(index, 1);

                // Handle Master Disconnection with Grace Period
                if (wasMaster) {
                    if (room.users.length > 0) {
                        // Set grace period for master to rejoin
                        room.pendingMasterId = socket.id;
                        console.log(`Room ${roomId}: Master ${socket.id} disconnected. Starting 15s grace period...`);

                        // 15-second grace period before reassigning master
                        room.masterGraceTimeout = setTimeout(() => {
                            // Grace period expired, reassign to next user
                            if (rooms[roomId] && room.pendingMasterId === socket.id) {
                                room.masterId = room.users[0].id;
                                room.pendingMasterId = null;
                                room.masterGraceTimeout = null;
                                room.masterEpoch += 1;

                                console.log(`Room ${roomId}: Grace period expired. Master reassigned to ${room.masterId} (epoch: ${room.masterEpoch})`);

                                // Pause music for all remaining users when grace period expires
                                io.to(roomId).emit('master_paused');
                                io.to(roomId).emit('master_update', {
                                    masterId: room.masterId,
                                    masterEpoch: room.masterEpoch
                                });
                            }
                        }, 15000);

                        // Notify users that master is temporarily unavailable (but don't pause yet)
                        io.to(roomId).emit('users_update', room.users);
                    } else {
                        // Room is empty, destroy it and clear any timeouts
                        if (room.masterGraceTimeout) {
                            clearTimeout(room.masterGraceTimeout);
                            room.masterGraceTimeout = null;
                        }
                        delete rooms[roomId];
                        console.log(`Room ${roomId}: Last user disconnected. Room destroyed.`);
                    }
                } else if (room.users.length === 0) {
                    // Non-master user left and room is now empty
                    if (room.masterGraceTimeout) {
                        clearTimeout(room.masterGraceTimeout);
                        room.masterGraceTimeout = null;
                    }
                    delete rooms[roomId];
                    console.log(`Room ${roomId}: Last user left. Room destroyed.`);
                } else {
                    // Room still has users
                    io.to(roomId).emit('users_update', room.users);
                }

                console.log(`User removed from room ${roomId} (epoch: ${room.masterEpoch})`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Coordinator Server running on port ${PORT}`);
});
