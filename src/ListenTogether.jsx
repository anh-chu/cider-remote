import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Users, LogIn, Share2, PlayCircle, Plus, Search, X, Music, Trash2, GripVertical, Crown, Settings, LogOut, AlertTriangle, Play, ListPlus, ListMusic, Bug, Download } from 'lucide-react';

export default function ListenTogether({
    isConnected,
    ciderState, // { isPlaying, currentSong, timestamp }
    onRemoteAction, // (action, payload) => void
    setRemoteControls, // (controls) => void
    apiCall // (endpoint, method, body) => Promise<any>
}) {
    const [socket, setSocket] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [roomId, setRoomId] = useState('');
    const [username, setUsername] = useState('');
    const [serverUrl, setServerUrl] = useState(() => {
        try {
            return localStorage.getItem('cider_remote_url') || 'http://localhost:3001';
        } catch (e) {
            console.error('Failed to load server URL from localStorage:', e);
            return 'http://localhost:3001';
        }
    });
    const [pendingServerUrl, setPendingServerUrl] = useState(serverUrl);
    const [isSavingServerUrl, setIsSavingServerUrl] = useState(false);
    const [serverUrlSaved, setServerUrlSaved] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [joinedRoom, setJoinedRoom] = useState(null);
    const [queue, setQueue] = useState([]);
    const [users, setUsers] = useState([]);
    const [masterId, setMasterId] = useState(null);
    const [history, setHistory] = useState([]);

    const [serverState, setServerState] = useState(null);
    const [error, setError] = useState('');
    const [serverConnectionStatus, setServerConnectionStatus] = useState('disconnected'); // 'disconnected', 'connecting', 'connected', 'error'

    // [NEW] Clock Sync State
    const [clockOffset, setClockOffset] = useState(0); // Estimated offset between local and server time (ms)
    const [rtt, setRtt] = useState(100); // Round-trip time estimate (ms)
    const clockSyncSamplesRef = useRef([]); // Store samples for median filtering
    const lastSeqRef = useRef(0); // [NEW] Track last seen sequence number
    const masterEpochRef = useRef(0); // [NEW] Track current master epoch

    // Search State
    const [showSearch, setShowSearch] = useState(false);
    const [searchQuery, setSearchQuery] = useState(''); // Renamed from searchTerm
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
    const [activeTab, setActiveTab] = useState('queue'); // [NEW] Added for Tabs UI

    // [DEBUG] Compact debug logging - only seeks and periodic summaries
    const [debugMode, setDebugMode] = useState(() => {
        try {
            return localStorage.getItem('cider_debug_mode') === 'true';
        } catch (e) {
            return false;
        }
    });
    const debugModeRef = useRef(debugMode);
    debugModeRef.current = debugMode;
    const debugStatsRef = useRef({ seeks: [], drifts: [], lastSummary: 0 });

    // Compact single-line log for seeks only
    const logSeek = (from, to, diff, reason) => {
        if (!debugModeRef.current) return;
        const stats = debugStatsRef.current;
        const entry = { t: Date.now(), from, to, diff, reason };
        stats.seeks.push(entry);
        if (stats.seeks.length > 100) stats.seeks.shift();
        console.log(`[SEEK] ${from.toFixed(1)}→${to.toFixed(1)} (Δ${diff.toFixed(2)}s) ${reason}`);
    };

    // Track drift samples for summary
    const trackDrift = (diff) => {
        if (!debugModeRef.current) return;
        const stats = debugStatsRef.current;
        stats.drifts.push(diff);
        if (stats.drifts.length > 50) stats.drifts.shift();

        // Log summary every 5 seconds
        const now = Date.now();
        if (now - stats.lastSummary > 5000 && stats.drifts.length > 0) {
            stats.lastSummary = now;
            const avg = stats.drifts.reduce((a, b) => a + b, 0) / stats.drifts.length;
            const max = Math.max(...stats.drifts);
            const seekCount = stats.seeks.filter(s => s.t > now - 5000).length;
            console.log(`[SYNC] avg=${avg.toFixed(2)}s max=${max.toFixed(2)}s seeks=${seekCount}/5s`);
        }
    };

    const exportDebugLogs = () => {
        const data = {
            exported: new Date().toISOString(),
            seeks: debugStatsRef.current.seeks,
            recentDrifts: debugStatsRef.current.drifts
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sync-debug-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const toggleDebugMode = () => {
        const newValue = !debugMode;
        setDebugMode(newValue);
        try {
            localStorage.setItem('cider_debug_mode', newValue.toString());
        } catch (e) {}
        if (newValue) {
            debugStatsRef.current = { seeks: [], drifts: [], lastSummary: 0 };
            console.log('[DEBUG] ON - tracking seeks and drift');
        } else {
            console.log('[DEBUG] OFF');
        }
    };

    // [NEW] Clock Sync Protocol
    const performClockSync = (s, numSamples = 5) => {
        let sampleIndex = 0;
        const samples = [];

        const sendNextPing = () => {
            if (sampleIndex < numSamples) {
                s.emit('time_sync_request', {
                    clientTime: Date.now(),
                    sampleIndex
                });
            }
        };

        const handleResponse = ({ clientTime, serverTime, sampleIndex: idx }) => {
            const receiveTime = Date.now();
            const roundTrip = receiveTime - clientTime;
            // offset = serverTime - clientTime - (rtt / 2)
            // This estimates what the server's clock read at the moment we sent the request
            const offset = serverTime - clientTime - (roundTrip / 2);

            samples.push({ offset, rtt: roundTrip });

            sampleIndex++;
            if (sampleIndex < numSamples) {
                // Small delay between samples to avoid burst
                setTimeout(sendNextPing, 50);
            } else {
                // Done collecting samples, calculate median offset
                // Use median to reject outliers
                const sortedOffsets = samples.map(s => s.offset).sort((a, b) => a - b);
                const sortedRtts = samples.map(s => s.rtt).sort((a, b) => a - b);
                const medianOffset = sortedOffsets[Math.floor(sortedOffsets.length / 2)];
                const medianRtt = sortedRtts[Math.floor(sortedRtts.length / 2)];

                setClockOffset(medianOffset);
                setRtt(medianRtt);
                clockSyncSamplesRef.current = samples;

                // Report to server for debugging
                s.emit('time_sync_report', { offset: medianOffset, rtt: medianRtt });

                console.log(`Clock sync complete: offset=${medianOffset}ms, rtt=${medianRtt}ms`);

                // Remove listener after sync is complete
                s.off('time_sync_response', handleResponse);
            }
        };

        s.on('time_sync_response', handleResponse);
        sendNextPing();
    };

    const saveServerUrl = () => {
        setIsSavingServerUrl(true);
        try {
            localStorage.setItem('cider_remote_url', pendingServerUrl);
            setServerUrl(pendingServerUrl);
            setServerUrlSaved(true);
            setTimeout(() => {
                setIsSavingServerUrl(false);
                setServerUrlSaved(false);
            }, 1500);
        } catch (err) {
            console.error('Failed to save server URL to localStorage:', err);
            setIsSavingServerUrl(false);
        }
    };

    const connect = async () => {
        try {
            setServerConnectionStatus('connecting');
            const s = io(serverUrl);

            s.on('connect', () => {
                console.log('Connected to Coordinator');
                setError('');
                setServerConnectionStatus('connected');
                // [NEW] Perform initial clock sync on connection
                performClockSync(s);
            });

            s.on('connect_error', (error) => {
                console.error('Connection error:', error);
                setServerConnectionStatus('error');
                setError(`Server error: ${error.message || 'Connection failed'}`);
            });

            s.on('disconnect', (reason) => {
                console.log('Disconnected from Coordinator:', reason);
                setServerConnectionStatus('disconnected');
                if (reason === 'io server disconnect') {
                    setError('Server disconnected');
                } else if (reason === 'transport close') {
                    setError('Connection lost');
                }
            });

            s.on('sync_state', (state) => {
                const q = state.queue || [];
                console.log("📥 Slave: Received Sync State. Queue Len:", q.length, "Source:", state.source, "Seq:", state.playback?.seq);
                console.log("📥 Slave: Received Song:", state.playback?.currentSong?.name, "| ID:", state.playback?.currentSong?.id, "| playParams.id:", state.playback?.currentSong?.playParams?.id);

                // [NEW] Check sequence number - reject out-of-order updates
                const incomingSeq = state.playback?.seq || 0;
                if (incomingSeq > 0 && incomingSeq <= lastSeqRef.current) {
                    console.log(`Rejecting out-of-order sync_state (seq ${incomingSeq} <= ${lastSeqRef.current})`);
                    return;
                }
                lastSeqRef.current = incomingSeq;

                // [NEW] Check master epoch - reject stale master updates
                if (state.masterEpoch !== undefined) {
                    if (state.masterEpoch < masterEpochRef.current) {
                        console.log(`Rejecting stale sync_state (epoch ${state.masterEpoch} < ${masterEpochRef.current})`);
                        return;
                    }
                    masterEpochRef.current = state.masterEpoch;
                }

                if (q.length === 0) console.warn("Slave: Received EMPTY queue!");
                setQueue(q);
                setHistory(state.history || []);
                if (state.playback) {
                    state.playback.localReceivedTime = Date.now();
                    // [NEW] Store server time for clock-adjusted calculations
                    state.playback.serverTimestamp = state.serverTime || state.playback.serverTime;
                }
                setServerState(state.playback);
                if (state.users) setUsers(state.users);
                if (state.masterId) setMasterId(state.masterId);
            });

            s.on('master_update', (data) => {
                // [NEW] Handle both old format (just id) and new format ({masterId, masterEpoch})
                const id = data.masterId !== undefined ? data.masterId : data;
                const epoch = data.masterEpoch;

                console.log("Client: Received Master Update:", id, "Epoch:", epoch, "My ID:", s.id);

                // [NEW] Update epoch if provided
                if (epoch !== undefined) {
                    masterEpochRef.current = epoch;
                    // Reset sequence on epoch change
                    lastSeqRef.current = 0;
                }

                setMasterId(id);
            });

            s.on('users_update', (u) => {
                setUsers(u);
            });

            s.on('queue_update', (q) => {
                setQueue(q || []);
            });

            s.on('history_update', (h) => {
                setHistory(h || []);
            });

            s.on('playback_update', (pb) => {
                if (pb) {
                    pb.localReceivedTime = Date.now();
                }
                setServerState(pb);
            });

            s.on('master_paused', async () => {
                console.log('Master disconnected: pausing music for all users');
                try {
                    await onRemoteAction('pause');
                } catch (e) {
                    console.error('Failed to pause on master disconnect:', e);
                }
            });

            setSocket(s);
        } catch (e) {
            setServerConnectionStatus('error');
            setError("Socket.io-client not installed or server down");
        }
    };

    const joinRoom = (e) => {
        e.preventDefault();
        if (!socket || !roomId) return;
        if (!socket.connected) socket.connect(); // [Safety] Ensure connected

        // [NEW] Reset sync state when joining a new room
        lastSeqRef.current = 0;
        masterEpochRef.current = 0;

        socket.emit('join_room', { roomId, username: username.trim() || 'Anonymous' });
        setJoinedRoom(roomId);

        // [NEW] Re-sync clock when joining a room for fresh calibration
        performClockSync(socket);
    };

    // [NEW] Periodic clock re-synchronization (every 30 seconds while in room)
    useEffect(() => {
        if (!socket || !joinedRoom) return;

        const resyncInterval = setInterval(() => {
            performClockSync(socket);
        }, 30000); // Re-sync every 30 seconds

        return () => clearInterval(resyncInterval);
    }, [socket, joinedRoom]);

    const handleSearch = async (queryOrEvent) => {
        let query = queryOrEvent;
        // Handle Form Submit Event
        if (queryOrEvent && queryOrEvent.preventDefault) {
            queryOrEvent.preventDefault();
            query = searchQuery;
        }

        if (!query || typeof query !== 'string' || !query.trim()) return;

        setIsSearching(true);
        try {
            // Note: onRemoteAction returns the promise.
            // But wait, onRemoteAction is void in props?
            // "onRemoteAction: (action, payload) => void"
            // The App.jsx implementation of onRemoteAction calls apiCall but DOES IT RETURN results?
            // Let's check App.jsx next. If it doesn't return, we need to fix it.
            // Assuming it returns for now, as the previous code awaited it.
            const results = await onRemoteAction('search', query);
            if (results && Array.isArray(results)) {
                setSearchResults(results);
            } else {
                setSearchResults([]);
            }
        } catch (e) {
            console.error("Search failed", e);
        } finally {
            setIsSearching(false);
        }
    };

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchQuery.trim().length > 2) {
                handleSearch(searchQuery);
            }
        }, 500); // 500ms debounce
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Track last sync to avoid loops when Cider is slow to update
    const lastSongSync = useRef({ id: null, time: 0 });
    const lastSeekSync = useRef(0); // Throttle seek actions
    const ciderStateRef = useRef(ciderState); // [NEW] Ref for stable polling
    const queueRef = useRef([]); // [FastPath] Cached Queue
    const historyRef = useRef([]); // [FastPath] Cached History
    const hasFetchedRef = useRef(false); // [FastPath] Ensure we have fetched at least once
    const lastServerSeekTSRef = useRef(0); // [Fix] Smart Guard
    ciderStateRef.current = ciderState; // [Fix] Always keep ref fresh synchronously (Render Phase)

    // [Debug] Trace Master Promotion
    useEffect(() => {
        const isMaster = socket && socket.id === masterId;
        console.log("Client: Master State Changed. MasterId:", masterId, "My socket:", socket?.id, "IsMaster:", isMaster);
    }, [masterId, socket]);

    // Sync Logic: React to Server State & Master Logic
    useEffect(() => {
        if (!serverState || !joinedRoom) return;

        const { isPlaying, currentSong, timestamp, lastUpdated, source, localReceivedTime } = serverState;
        // console.log("Slave: Sync Effect Triggered. Server TS:", timestamp, "IsPlaying:", isPlaying);

        // --- MASTER LOGIC (Push State) ---
        // Verify we are not syncing to ourselves
        if (socket && socket.id === masterId && source === 'master') {
            return;
        }

        // [Fix] Smart Guard: Check if this is a NEW seek or just a tick
        const serverSeekTS = serverState.playback?.lastSeekTimestamp || 0;
        const isNewSeek = serverSeekTS !== lastServerSeekTSRef.current;

        // [Fix] Inbound Sync Debounce: Ignore Master updates for 8.5s after manual seek
        // UNLESS it's a confirmed NEW seek from the Master
        if (ciderState.lastSeekTimeRef && (Date.now() - ciderState.lastSeekTimeRef.current < 8500)) {
            if (isNewSeek) {
                console.log("Sync: Smart Guard - Accepted NEW Master Seek despite debounce. SV:", serverSeekTS, "Last:", lastServerSeekTSRef.current);
                lastServerSeekTSRef.current = serverSeekTS; // Update tracker
                // Allow fall-through to sync
            } else {
                // console.log("Sync: Ignoring sync due to local seek debounce (Tick)");
                return;
            }
        } else if (isNewSeek) {
            console.log("Sync: New Seek Detected (Normal). SV:", serverSeekTS);
            lastServerSeekTSRef.current = serverSeekTS; // Update tracker for normal syncs too
        }

        // --- FOLLOWER LOGIC (Pull State) ---
        // (Or Master in 'queue' mode)

        // Logging for debug
        // if (source === 'master') console.log("Follower Syncing from Master:", currentSong?.name);

        // Playback State Sync
        // Only sync if local state is valid (boolean)
        // AND we are not currently waiting for a song switch to complete (Debounce)
        const isSongLoading = (Date.now() - lastSongSync.current.time) < 5000;

        if (!isSongLoading && typeof ciderState.isPlaying === 'boolean' && isPlaying !== ciderState.isPlaying) {
            onRemoteAction(isPlaying ? 'play' : 'pause');
        }

        // Song Sync
        // Only sync if local state is valid (object or null, not error object)
        const localName = ciderState.nowPlaying?.name;
        if (currentSong?.name !== localName) {
            console.log("🎵 Sync: Song mismatch detected! Server:", currentSong?.name, "| Local:", localName);
            // Avoid syncing if local state looks like an error
            if (ciderState.nowPlaying && ciderState.nowPlaying.error) {
                console.log("Sync: Ignoring song sync due to local error state");
            } else {
                // DEBOUNCE: If we just synced this song < 5 seconds ago, wait.
                // This handles the gap between "Request Play" and "Cider Updates State"
                // Prefer catalogId for consistency (library IDs are user-specific)
                const songId = currentSong?.playParams?.catalogId ||
                              currentSong?.catalogId ||
                              currentSong?.playParams?.id ||
                              currentSong?.id ||
                              currentSong?.name;
                const now = Date.now();

                // Only apply debounce if we have a valid songId AND it matches the last sync
                const shouldDebounce = songId && lastSongSync.current.id &&
                                      songId === lastSongSync.current.id &&
                                      (now - lastSongSync.current.time) < 5000;

                console.log("🔍 Sync Debug: songId:", songId, "| lastSync:", lastSongSync.current.id, "| shouldDebounce:", shouldDebounce);

                if (shouldDebounce) {
                    console.log("⏸️ Sync: Debouncing Song Sync (waiting for Cider to load)...");
                } else {
                    console.log("▶️ Sync: Attempting to play:", currentSong?.name, "| Song Object:", JSON.stringify(currentSong, null, 2));
                    if (currentSong && (!localName || currentSong.name !== localName)) {
                        console.log("✅ Sync: Triggering Play Song:", currentSong.name);
                        lastSongSync.current = { id: songId, time: now }; // Update Ref
                        onRemoteAction('play_song', currentSong);
                    } else {
                        console.log("❌ Sync: Skipping - condition not met");
                    }
                }
            }
        }

        // Time Drift Sync (with clock offset compensation)
        // Only sync time if we are on the correct song!
        if (currentSong?.name === localName && localName) {
            // [NEW] Use clock-adjusted time calculation
            // serverTimestamp is the authoritative server time when the state was created
            const serverTimestamp = serverState.serverTimestamp || localReceivedTime || lastUpdated;

            // Calculate the elapsed time since the state was created
            // Adjust for clock offset: localNow + offset ≈ serverNow
            const localNow = Date.now();
            const adjustedLocalNow = localNow + clockOffset; // What we think server time is now
            const elapsedSinceUpdate = (adjustedLocalNow - serverTimestamp) / 1000;

            // Calculate expected position based on master's timestamp + elapsed time
            let expectedPosition = timestamp;
            if (isPlaying) {
                expectedPosition += elapsedSinceUpdate;
            }

            // [NEW] Apply latency compensation: pre-seek by half RTT
            // This accounts for the time it takes for our seek command to reach Cider
            const latencyCompensation = (rtt / 2) / 1000; // Convert ms to seconds
            if (isPlaying) {
                expectedPosition += latencyCompensation;
            }

            const localTime = ciderState.currentTime;
            const diff = Math.abs(expectedPosition - localTime);
            const direction = expectedPosition > localTime ? 'ahead' : 'behind'; // master is ahead/behind local

            // [NEW] Three-tier drift threshold (like Spotify Jam)
            // - Jitter threshold: 150ms (ignore - normal network variance)
            // - Soft threshold: 150ms - 1s (could rate-adjust, but we just seek for now)
            // - Hard threshold: > 1s (definitely seek)
            const JITTER_THRESHOLD = 0.15; // 150ms - ignore
            const SOFT_THRESHOLD = 0.5;    // 500ms - seek with logging
            const HARD_THRESHOLD = 1.0;    // 1s - hard seek

            // Allow larger drift during song transitions (first 5 seconds)
            const isTransitioning = lastSongSync.current.id && (Date.now() - lastSongSync.current.time) < 5000;
            const effectiveThreshold = isTransitioning ? HARD_THRESHOLD * 2 : SOFT_THRESHOLD;

            // [DEBUG] Track drift for summary (compact logging)
            trackDrift(diff);

            // [NEW] Smarter sync logic
            if (isNewSeek || diff > effectiveThreshold) {
                // Only log if drift is significant
                if (diff > JITTER_THRESHOLD) {
                    console.log(`Sync: Drift detected (${diff.toFixed(2)}s). Expected: ${expectedPosition.toFixed(2)}s, Local: ${localTime.toFixed(2)}s, Offset: ${clockOffset}ms, RTT: ${rtt}ms`);
                }

                // Throttle Seek: Only seek once per 1.5 seconds (reduced from 3s) to avoid spamming
                // UNLESS it is a confirmed NEW seek from Master (Bypass Throttle)
                const now = Date.now();
                const seekThrottle = isNewSeek ? 0 : 1500;
                const timeSinceLastSeek = now - lastSeekSync.current;
                const willSeek = (timeSinceLastSeek > seekThrottle) || isNewSeek;
                const passesJitterThreshold = diff > JITTER_THRESHOLD || isNewSeek;

                if (willSeek) {
                    lastSeekSync.current = now;

                    // Only seek if drift exceeds jitter threshold (skip micro-corrections)
                    if (passesJitterThreshold) {
                        // [DEBUG] Compact seek logging
                        const reason = isNewSeek ? 'master-seek' : (isTransitioning ? 'transition' : 'drift');
                        logSeek(localTime, expectedPosition, diff, reason);
                        onRemoteAction('seek', expectedPosition);
                    }
                }
            }
        }

    }, [serverState, ciderState, masterId, socket, joinedRoom, clockOffset, rtt]);

    // Handle Server Requests (Master Only)
    useEffect(() => {
        if (!socket) return;

        socket.on('request_master_next', () => {
            onRemoteAction('next');
        });

        return () => {
            socket.off('request_master_next');
        };
    }, [socket, onRemoteAction]);

    // Sync pending URL when settings are toggled
    useEffect(() => {
        if (showSettings) {
            setPendingServerUrl(serverUrl);
        }
    }, [showSettings, serverUrl]);

    // [DEBUG] Lifecycle Check
    useEffect(() => {
        return () => { };
    }, []);

    // [NEW] Master/Local Logic: Polling & Broadcasting (Authority)
    useEffect(() => {
        // Run if:
        // 1. We are the Master in a room
        // 2. We are NOT in a room (Local Mode) - assuming we want to see our own queue
        const isMaster = socket && joinedRoom && socket.id === masterId;
        const isLocal = !joinedRoom;

        if (!isMaster && !isLocal) return;

        let isActive = true;
        let timeoutId;
        const poll = async () => {
            // Re-check authority inside loop (captured from closure, but good practice)
            if (!isActive || (!isMaster && !isLocal)) return;

            try {
                // [Fast Path] If we just sought (< 1000ms) AND have cached data, skip heavy API calls.
                const timeSinceSeek = Date.now() - (ciderStateRef.current.lastSeekTimestamp || 0);
                const hasCachedData = queueRef.current && queueRef.current.length > 0;
                const isFastPoll = timeSinceSeek < 1000 && hasCachedData;

                let queueData = null;
                let nowPlayingData = null;

                if (isFastPoll) {
                    console.log("Master: Fast Poll (Skipping API)"); // [Debug] Confirm optimisation
                } else {
                    const [q, np] = await Promise.all([
                        apiCall('/queue'),
                        apiCall('/now-playing')
                    ]);
                    queueData = q;
                    nowPlayingData = np;
                    hasFetchedRef.current = true; // [Fix] Mark fetched regardless of content
                }

                // [Fix] Race Condition: If we switched modes (e.g. joined a room) while waiting, STOP.
                if (!isActive) return;

                let historyList = historyRef.current;
                let upNextList = queueRef.current;

                if (queueData) {
                    // Normalize Queue Items
                    const fullQueue = (Array.isArray(queueData) ? queueData : (queueData.results || []))
                        .map(item => {
                            const attrs = item.attributes || item;
                            return {
                                id: item.id,
                                name: attrs.name,
                                artistName: attrs.artistName,
                                artwork: attrs.artwork,
                                durationInMillis: attrs.durationInMillis,
                                playParams: attrs.playParams // Important for ID playback
                            };
                        });

                    // Identify Current Song to split
                    // We prioritize playParams.id as it is more reliable for catalog resources.
                    const activeId = nowPlayingData?.playParams?.id ||
                        nowPlayingData?.attributes?.playParams?.id ||
                        nowPlayingData?.id ||
                        ciderStateRef.current.nowPlaying?.playParams?.id ||
                        ciderStateRef.current.nowPlaying?.id;

                    const currentIndex = fullQueue.findIndex(item => {
                        const itemId = item.playParams?.id || item.id;
                        return String(itemId) === String(activeId);
                    });

                    if (currentIndex !== -1) {
                        historyList = fullQueue.slice(0, currentIndex);
                        // Up Next should be everything AFTER current song
                        upNextList = fullQueue.slice(currentIndex + 1);
                    } else {
                        // Fallback: If we can't find current song, maybe it's at index 0?
                        // Or maybe the whole list is Up Next?
                        // Let's assume whole list is Up Next if we can't match?
                        // Or maybe we haven't started playing yet?
                        upNextList = fullQueue;
                    }
                }

                // 3. Update Local State (So Master sees it too!)
                if (queueData) { // Only update if we fetched fresh data
                    setQueue(upNextList);
                    setHistory(historyList);
                    queueRef.current = upNextList;
                    historyRef.current = historyList;
                    hasFetchedRef.current = true; // [Fix] Mark as valid for Fast Path
                }

                // 4. Broadcast to Room (If in room)
                if (isMaster) {
                    if (upNextList.length === 0) console.warn("Master: About to broadcast EMPTY queue! Source data:", queueData ? queueData.length : 'null');
                    console.log("📡 Master Broadcasting - Song:", ciderStateRef.current.nowPlaying?.name, "| ID:", ciderStateRef.current.nowPlaying?.id, "| playParams.id:", ciderStateRef.current.nowPlaying?.playParams?.id);
                    socket.emit('master_state_update', {
                        roomId: joinedRoom,
                        masterEpoch: masterEpochRef.current, // [NEW] Include epoch for validation
                        state: {
                            queue: upNextList,
                            history: historyList,
                            source: 'master', // Enforce that we are the source
                            playback: {
                                isPlaying: ciderStateRef.current.isPlaying,
                                currentSong: ciderStateRef.current.nowPlaying, // Send full object
                                // [Fix] Master Broadcast Debounce
                                // If we (Master) just sought, broadcast our optimistic time, NOT the lagging API time.
                                timestamp: (ciderStateRef.current.lastSeekTimeRef && Date.now() - ciderStateRef.current.lastSeekTimeRef.current < 8500)
                                    ? ciderStateRef.current.currentTime
                                    : ciderStateRef.current.currentTime, // Actually, ciderState.currentTime IS optimistic in App.jsx now due to its own debounce!
                                // [Fix] Smart Guard: Send Seek Timestamp ID
                                lastSeekTimestamp: ciderStateRef.current.lastSeekTimestamp,
                                // Wait, App.jsx's currentTime is already debounced?
                                // Yes. App.jsx:208 "if !isSeeking... debounce... setCurrentTime".
                                // So ciderStateRef.current.currentTime holds the "Clean" time.
                                // The issue is if "fetchData" updated it too fast?
                                // Actually, let's be explicit and force the optimistic value if we are seeking.
                                // Re-reading App.jsx: When seeking, currentTime = seekValue.
                                // When commit, isSeeking=false. But LastSeekTime is set. Use that.
                                lastUpdated: Date.now()
                            }
                        }
                    });
                }
            } catch (e) {
                console.error("Master Poll Failed:", e);
            }

            // Schedule next poll (recursive)
            if (isActive) timeoutId = setTimeout(poll, 1500);
        };

        if (isActive) poll(); // Start Loop

        // [NEW] Handle Remote Actions (Relayed from Server)
        const handleRemoteRequest = async ({ action, payload, requesterId }) => {
            console.debug(`Master: Received remote request '${action}' from ${requesterId}`);
            if (action === 'seek') {
                console.log("Master: Handling Remote Seek to", payload, "Current State TS:", ciderStateRef.current.currentTime);
            }
            try {
                if (action === 'add') {
                    // "playLater" = Add to End of Queue
                    const songId = payload.id || payload.song?.id;
                    if (songId) await apiCall('/play-later', 'POST', { id: songId, type: 'songs' });
                } else if (action === 'play_next') {
                    // "playNext" = Insert after current song
                    const songId = payload.id || payload.song?.id;
                    if (songId) await apiCall('/play-next', 'POST', { id: songId, type: 'songs' });
                } else if (action === 'remove') {
                    // Cider API is 1-indexed for queue operations
                    if (payload.index !== undefined) {
                        await apiCall('/queue/remove-by-index', 'POST', { index: payload.index + 1 });
                    }
                } else if (action === 'move') {
                    // Cider API is 1-indexed for queue operations
                    if (payload.fromIndex !== undefined && payload.toIndex !== undefined) {
                        await apiCall('/queue/move-to-position', 'POST', {
                            fromIndex: payload.fromIndex + 1,
                            toIndex: payload.toIndex + 1
                        });
                    }
                } else if (action === 'next') {
                    await onRemoteAction('next');
                } else if (action === 'previous') {
                    await onRemoteAction('previous');
                } else if (action === 'play') {
                    await onRemoteAction('play');
                } else if (action === 'pause') {
                    await onRemoteAction('pause');
                } else if (action === 'seek') {
                    await onRemoteAction('seek', payload);
                } else if (action === 'play_song') {
                    await onRemoteAction('play_song', payload);
                }
            } catch (e) {
                console.error("Master: Failed to execute remote action:", e);
            }
        };

        if (socket) {
            socket.on('remote_action_request', handleRemoteRequest);
        }

        return () => {
            isActive = false;
            if (timeoutId) clearTimeout(timeoutId);
            if (socket) socket.off('remote_action_request', handleRemoteRequest);
        };
    }, [socket, joinedRoom, masterId, ciderState.lastSeekTimestamp]); // [Fix] Restart poll immediately on seek (Use Value not Ref)

    // Get status display info
    const getStatusDisplay = () => {
        switch (serverConnectionStatus) {
            case 'connected':
                return { text: 'Remote Server Connected', bgColor: 'bg-green-500', textColor: 'text-green-400', pulse: true };
            case 'connecting':
                return { text: 'Remote Server Connecting...', bgColor: 'bg-yellow-500', textColor: 'text-yellow-400', pulse: true };
            case 'disconnected':
                return { text: 'Remote Server Disconnected', bgColor: 'bg-red-500', textColor: 'text-red-400', pulse: false };
            case 'error':
                return { text: 'Remote Server Error', bgColor: 'bg-orange-500', textColor: 'text-orange-400', pulse: true };
            default:
                return { text: 'Remote Server Disconnected', bgColor: 'bg-red-500', textColor: 'text-red-400', pulse: false };
        }
    };

    // Register Remote Controls
    useEffect(() => {
        const isMasterMode = socket && socket.id === masterId && serverState?.source === 'master';

        // Slaves send requests to Master via Server Relay
        if (joinedRoom && socket && socket.id !== masterId) {
            setRemoteControls({
                play: () => socket.emit('remote_action', { roomId: joinedRoom, action: 'play' }),
                pause: () => socket.emit('remote_action', { roomId: joinedRoom, action: 'pause' }),
                next: () => socket.emit('remote_action', { roomId: joinedRoom, action: 'next' }),
                prev: () => socket.emit('remote_action', { roomId: joinedRoom, action: 'previous' }),
                seek: (val) => socket.emit('remote_action', { roomId: joinedRoom, action: 'seek', payload: val }),
                add: (song) => socket.emit('remote_action', { roomId: joinedRoom, action: 'add', payload: song }),
                play_song: (song) => socket.emit('remote_action', { roomId: joinedRoom, action: 'play_song', payload: song }),
            });
        } else {
            setRemoteControls(null);
        }
        return () => setRemoteControls(null);
    }, [joinedRoom, socket, masterId, serverState?.source]);

    // UI Rendering
    // We ALWAYS render the Queue/History now.
    // Connect logic is put in a collapsible/header block.

    return (
        <div className="bg-neutral-800/50 rounded-xl p-4 pb-2 border border-white/10 min-h-[400px]">
            {/* Header / Connection Controls */}
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
                <div className="flex items-center gap-2 text-purple-400">
                    <Users size={20} />
                    <h3 className="font-bold">Listen Together</h3>
                    {!joinedRoom && (
                        <div className="flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                            {(() => {
                                const status = getStatusDisplay();
                                return (
                                    <>
                                        <div className={`w-1.5 h-1.5 rounded-full ${status.bgColor} ${status.pulse ? 'animate-pulse' : ''}`} />
                                        <span className={`text-[10px] ${status.textColor} font-medium`}>{status.text}</span>
                                    </>
                                );
                            })()}
                        </div>
                    )}
                </div>

                {!joinedRoom ? (
                    <div className="flex gap-2">
                        {!socket ? (
                            <button
                                onClick={connect}
                                className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1"
                            >
                                <LogIn size={12} /> Connect
                            </button>
                        ) : (
                            <form onSubmit={joinRoom} className="flex gap-2">
                                <input
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    placeholder="Name"
                                    className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none w-20"
                                    maxLength={10}
                                />
                                <input
                                    value={roomId}
                                    onChange={e => setRoomId(e.target.value)}
                                    placeholder="Room"
                                    className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none w-16"
                                    maxLength={5}
                                />
                                <button type="submit" className="bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded text-xs font-bold">
                                    Join
                                </button>
                            </form>
                        )}
                        {showSettings && (
                            <div className="flex items-center gap-1">
                                <input
                                    value={pendingServerUrl}
                                    onChange={e => setPendingServerUrl(e.target.value)}
                                    disabled={isSavingServerUrl}
                                    className="bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-white text-[10px] w-40 focus:outline-none focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                    placeholder="Server URL"
                                />
                                <button
                                    onClick={saveServerUrl}
                                    disabled={isSavingServerUrl || pendingServerUrl === serverUrl}
                                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-500 text-white px-2 py-1 rounded text-xs font-bold flex items-center gap-1 transition-colors disabled:cursor-not-allowed"
                                >
                                    {isSavingServerUrl ? (
                                        <>
                                            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                            <span>Saving...</span>
                                        </>
                                    ) : serverUrlSaved ? (
                                        <>
                                            <span>✓ Saved</span>
                                        </>
                                    ) : (
                                        <span>Save</span>
                                    )}
                                </button>
                            </div>
                        )}
                        <button onClick={() => setShowSettings(!showSettings)} className="text-white/20 hover:text-white p-1">
                            <Settings size={14} />
                        </button>
                        <button
                            onClick={toggleDebugMode}
                            className={`p-1 ${debugMode ? 'text-yellow-400' : 'text-white/20 hover:text-white'}`}
                            title={debugMode ? 'Debug mode ON - click to disable' : 'Enable debug mode'}
                        >
                            <Bug size={14} />
                        </button>
                        {debugMode && (
                            <button
                                onClick={exportDebugLogs}
                                className="text-yellow-400 hover:text-yellow-300 p-1"
                                title="Export debug logs"
                            >
                                <Download size={14} />
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 bg-gradient-to-r from-purple-900/50 to-pink-900/50 px-3 py-1 rounded-full border border-purple-500/20">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            <span className="text-xs font-bold text-white tracking-wide">Room: <span className="text-purple-300">{joinedRoom}</span></span>
                            <span className="w-px h-3 bg-white/10 mx-1"></span>
                            <span className="text-[10px] text-white/50 uppercase tracking-wider font-bold">
                                {socket.id === masterId ? 'HOST' : 'LISTENER'}
                            </span>
                            <span className="w-px h-3 bg-white/10 mx-1"></span>
                            <div className="flex items-center gap-1">
                                <Users size={12} className="text-purple-300" />
                                <span className="text-[10px] text-white/50 uppercase tracking-wider font-bold">
                                    {users.length} {users.length === 1 ? 'person' : 'people'}
                                </span>
                            </div>
                            <span className="w-px h-3 bg-white/10 mx-1"></span>
                            <div className="flex items-center gap-1">
                                {(() => {
                                    const status = getStatusDisplay();
                                    return (
                                        <>
                                            <div className={`w-1 h-1 rounded-full ${status.bgColor} ${status.pulse ? 'animate-pulse' : ''}`} />
                                            <span className={`text-[10px] ${status.textColor} uppercase tracking-wider font-bold`}>{status.text}</span>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                        <button
                            onClick={toggleDebugMode}
                            className={`p-1 ${debugMode ? 'text-yellow-400' : 'text-white/20 hover:text-white'}`}
                            title={debugMode ? 'Debug mode ON - click to disable' : 'Enable debug mode'}
                        >
                            <Bug size={14} />
                        </button>
                        {debugMode && (
                            <button
                                onClick={exportDebugLogs}
                                className="text-yellow-400 hover:text-yellow-300 p-1"
                                title={`Export debug logs (${debugLogsRef.current.length} entries)`}
                            >
                                <Download size={14} />
                            </button>
                        )}
                        <button onClick={() => {
                            if (socket) {
                                socket.emit('leave_room', { roomId: joinedRoom });
                                // Do NOT disconnect socket, keep it open for rejoin
                            }
                            setJoinedRoom(null);
                            setMasterId(null);
                            setQueue([]);
                            setHistory([]);
                            setServerState(null);
                            setUsers([]);
                            setError('');
                            setServerConnectionStatus(socket && socket.connected ? 'connected' : 'disconnected');
                            // [NEW] Reset sync state on leave
                            lastSeqRef.current = 0;
                            masterEpochRef.current = 0;
                            setClockOffset(0);
                            setRtt(100);
                        }} className="text-red-400 hover:text-red-300 p-1">
                            <LogOut size={14} />
                        </button>
                    </div>
                )}
            </div>

            {/* Error Message */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-200 text-xs p-2 rounded-lg mb-4 flex items-center gap-2">
                    <AlertTriangle size={12} />
                    {error}
                </div>
            )}

            {/* Tabs */}
            <div className="flex items-center gap-4 mb-4 border-b border-white/5 px-2">
                <button
                    onClick={() => setActiveTab('queue')}
                    className={`pb-2 text-sm font-bold transition-colors relative ${activeTab === 'queue' ? 'text-white' : 'text-white/40 hover:text-white/60'}`}
                >
                    Up Next
                    {activeTab === 'queue' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-500 rounded-t-full" />}
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`pb-2 text-sm font-bold transition-colors relative ${activeTab === 'history' ? 'text-white' : 'text-white/40 hover:text-white/60'}`}
                >
                    Recently Played
                    {activeTab === 'history' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-500 rounded-t-full" />}
                </button>
                <button
                    onClick={() => setActiveTab('people')}
                    className={`pb-2 text-sm font-bold transition-colors relative ${activeTab === 'people' ? 'text-white' : 'text-white/40 hover:text-white/60'}`}
                >
                    People
                    {activeTab === 'people' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-500 rounded-t-full" />}
                </button>
                <button
                    onClick={() => setActiveTab('search')}
                    className={`pb-2 text-sm font-bold transition-colors relative ${activeTab === 'search' ? 'text-white' : 'text-white/40 hover:text-white/60'}`}
                >
                    Search
                    {activeTab === 'search' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-500 rounded-t-full" />}
                </button>
            </div>

            {/* Content Area */}
            <div className="min-h-[300px] max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                {activeTab === 'people' ? (
                    <div className="space-y-2">
                        {users.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-white/20">
                                <Users size={32} className="mb-2 opacity-50" />
                                <p className="text-xs">No one in room</p>
                            </div>
                        ) : (
                            users.map((user) => (
                                <div
                                    key={user.id}
                                    className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                                >
                                    <div className="flex-1">
                                        <p className="text-xs font-bold text-white">{user.name}</p>
                                        <p className="text-[10px] text-white/40">
                                            {socket?.id === user.id ? 'You' : ''}
                                            {socket?.id === user.id && socket?.id === masterId ? ' • ' : ''}
                                            {socket?.id === user.id && socket?.id === masterId ? 'Host' : ''}
                                            {socket?.id !== user.id && user.id === masterId ? 'Host' : ''}
                                        </p>
                                    </div>
                                    {user.id === masterId && (
                                        <Crown size={14} className="text-yellow-500" />
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                ) : activeTab === 'search' ? (
                    <div className="space-y-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={16} />
                            <input
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search Apple Music..."
                                className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-purple-500/50 transition-colors placeholder:text-white/20"
                            />
                        </div>

                        <div className="space-y-1">
                            {searchResults.map((song) => (
                                <div key={song.id} className="group flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">
                                    <div className="relative w-10 h-10 rounded-md bg-neutral-800 overflow-hidden shrink-0">
                                        {song.artwork?.url && (
                                            <img src={song.artwork.url.replace('{w}', '100').replace('{h}', '100')} className="w-full h-full object-cover" />
                                        )}
                                        <button
                                            onClick={() => {
                                                // Remote Play Logic
                                                if (socket && joinedRoom && socket.id !== masterId) {
                                                    socket.emit('remote_action', { roomId: joinedRoom, action: 'play_song', payload: { id: song.id, name: song.name } });
                                                } else {
                                                    // Local/Master Play
                                                    apiCall('/play-item', 'POST', { id: song.id, type: 'songs' });
                                                }
                                            }}
                                            className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Play size={16} className="text-white fill-white" />
                                        </button>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-white text-sm truncate">{song.name}</div>
                                        <div className="text-xs text-white/40 truncate">{song.artistName} • {song.albumName}</div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (socket && joinedRoom && socket.id !== masterId) {
                                                socket.emit('remote_action', { roomId: joinedRoom, action: 'play_next', payload: { id: song.id } });
                                            } else {
                                                apiCall('/play-next', 'POST', { id: song.id, type: 'songs' });
                                            }
                                        }}
                                        className="p-2 text-white/40 hover:text-purple-400 opacity-0 group-hover:opacity-100 transition-all hover:bg-purple-500/10 rounded-lg"
                                        title="Play Next"
                                    >
                                        <ListMusic size={16} />
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (socket && joinedRoom && socket.id !== masterId) {
                                                socket.emit('remote_action', { roomId: joinedRoom, action: 'add', payload: { id: song.id } });
                                            } else {
                                                apiCall('/play-later', 'POST', { id: song.id, type: 'songs' });
                                            }
                                        }}
                                        className="p-2 text-white/40 hover:text-purple-400 opacity-0 group-hover:opacity-100 transition-all hover:bg-purple-500/10 rounded-lg"
                                        title="Add to Queue"
                                    >
                                        <ListPlus size={16} />
                                    </button>
                                </div>
                            ))}
                            {searchResults.length === 0 && searchQuery.length > 2 && (
                                <div className="text-center text-white/20 py-8 text-xs">No results found</div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {(activeTab === 'queue' ? queue : history).length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-white/20">
                                <ListMusic size={32} className="mb-2 opacity-50" />
                                <p className="text-xs">
                                    {activeTab === 'queue' ? 'Queue is empty' : 'No history available'}
                                </p>
                            </div>
                        ) : (
                            (activeTab === 'queue' ? queue : history).map((song, i) => (
                                <div
                                    key={`${song.id}-${i}`}
                                    draggable={activeTab === 'queue'} // Only draggable if queue
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('index', i);
                                    }}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        const fromIndex = parseInt(e.dataTransfer.getData('index'));
                                        const toIndex = i;
                                        if (fromIndex !== toIndex) {
                                            if (socket && joinedRoom && socket.id !== masterId) {
                                                // Slave: Emit 'move'
                                                socket.emit('remote_action', {
                                                    roomId: joinedRoom,
                                                    action: 'move',
                                                    payload: { fromIndex, toIndex }
                                                });
                                            } else {
                                                // Master/Local: Execute 'move' directly
                                                apiCall('/queue/move-to-position', 'POST', {
                                                    fromIndex: fromIndex + 1,
                                                    toIndex: toIndex + 1
                                                });
                                            }
                                        }
                                    }}
                                    className="flex items-center gap-2 bg-white/5 p-2 rounded-lg group hover:bg-white/10 transition-colors cursor-grab active:cursor-grabbing border border-transparent hover:border-white/5"
                                >
                                    {activeTab === 'queue' && <GripVertical size={12} className="text-white/20 group-hover:text-white/40" />}

                                    <div className="relative group/cover w-8 h-8 rounded bg-black/50 overflow-hidden shrink-0">
                                        {song.artwork?.url ? (
                                            <img src={song.artwork.url.replace('{w}', '64').replace('{h}', '64')} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-white/10"><Music size={12} /></div>
                                        )}
                                        <button
                                            onClick={() => {
                                                if (socket && joinedRoom && socket.id !== masterId) {
                                                    socket.emit('remote_action', { roomId: joinedRoom, action: 'play_song', payload: { id: song.id, index: i } });
                                                } else {
                                                    apiCall('/play-item', 'POST', { id: song.id, type: 'songs' });
                                                }
                                            }}
                                            className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover/cover:opacity-100 transition-opacity"
                                        >
                                            <PlayCircle size={16} className="text-white" />
                                        </button>
                                    </div>

                                    <div className="overflow-hidden flex-1">
                                        <p className="text-xs font-bold text-white truncate">{song.name}</p>
                                        <p className="text-[10px] text-white/50 truncate">{song.artistName}</p>
                                    </div>

                                    {activeTab === 'queue' && (
                                        <button
                                            onClick={() => {
                                                if (socket && joinedRoom && socket.id !== masterId) {
                                                    socket.emit('remote_action', { roomId: joinedRoom, action: 'remove', payload: { index: i } });
                                                } else {
                                                    apiCall('/queue/remove-by-index', 'POST', { index: i + 1 });
                                                }
                                            }}
                                            className="text-white/10 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 p-1"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

