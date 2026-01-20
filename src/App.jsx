import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Settings, RefreshCw, Repeat, Shuffle, Image as ImageIcon,
  AlertTriangle, Music, Disc, Loader2, Radio
} from 'lucide-react';
import ListenTogether from './ListenTogether';
import UpdateNotification from './UpdateNotification';

/**
 * CIDER REMOTE CONTROLLER
 * A comprehensive React app to control the Cider Apple Music client via RPC.
 * * UPDATES:
 * - Added 'Demo Mode' for UI testing without connection.
 * - implemented Smart Polling: Stops polling after 3 consecutive errors to prevent console spam.
 * - Enhanced Mixed Content warning visibility.
 */

// --- Components ---

const Card = ({ children, className = "" }) => (
  <div className={`bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl ${className}`}>
    {children}
  </div>
);

const Button = ({ onClick, children, className = "", variant = "primary", disabled = false, title = "" }) => {
  const baseStyle = "transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center";
  const variants = {
    primary: "bg-red-500 hover:bg-red-600 text-white rounded-full p-4 shadow-lg hover:shadow-red-500/20",
    secondary: "bg-white/10 hover:bg-white/20 text-white rounded-full p-3",
    ghost: "text-white/60 hover:text-white hover:bg-white/5 rounded-lg p-2",
    icon: "text-white/80 hover:text-white hover:scale-110 p-2",
    outline: "border border-white/20 text-white/80 hover:bg-white/10 rounded-lg p-2 text-sm"
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyle} ${variants[variant]} ${className}`}
      title={title}
    >
      {children}
    </button>
  );
};

const Slider = ({ value, max, onChange, onCommit, onSeekStart, className = "", step = 0.01 }) => {
  return (
    <input
      type="range"
      min="0"
      max={max}
      step={step}
      value={value || 0}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      onMouseDown={onSeekStart}
      onTouchStart={onSeekStart}
      onMouseUp={onCommit}
      onTouchEnd={onCommit}
      className={`w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-red-500 hover:accent-red-400 transition-all ${className}`}
    />
  );
};

// --- Main App Component ---

export default function App() {
  // Configuration State
  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('cider_config');
      return saved ? JSON.parse(saved) : { host: 'http://localhost:10767', token: '' };
    } catch (e) {
      console.error('Failed to load config from localStorage:', e);
      return { host: 'http://localhost:10767', token: '' };
    }
  });
  const [showSettings, setShowSettings] = useState(false);

  // Player State
  // Default to 'connecting' if we have a config, otherwise 'disconnected'
  const [status, setStatus] = useState(() => {
    try {
      return localStorage.getItem('cider_config') ? 'connecting' : 'disconnected';
    } catch (e) {
      console.error('Failed to check localStorage:', e);
      return 'disconnected';
    }
  });
  const [errorMsg, setErrorMsg] = useState('');
  const [nowPlaying, setNowPlaying] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffleMode, setShuffleMode] = useState(0);
  const [repeatMode, setRepeatMode] = useState(0);

  // Interaction State
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [isVolumneChanging, setIsVolumeChanging] = useState(false);
  const [localVolume, setLocalVolume] = useState(1);
  const [remoteControls, setRemoteControls] = useState(null); // { play, pause, next, prev }

  // Refs for interval management
  const pollInterval = useRef(null);
  const pollingTick = useRef(0); // For throttling less critical updates
  const playPauseDebounceRef = useRef(false);
  const lastFetchTimeRef = useRef(Date.now()); // [Optimization] Track time for optimistic ticks
  const lastAuthCheck = useRef(0);
  const lastSeekTime = useRef(0); // [Fix] Debounce for seek operations
  const errorCount = useRef(0);
  const MAX_RETRIES = 3;

  // --- API Helpers ---

  const apiCall = useCallback(async (endpoint, method = 'GET', body = null, base = '/api/v1/playback') => {

    const headers = {};
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    if (config.token) {
      const cleanToken = config.token.trim();
      if (cleanToken.length > 0) {
        headers['apitoken'] = cleanToken;
        headers['app-token'] = cleanToken;
      }
    }

    let host = config.host;

    const controller = new AbortController();
    // Use longer timeout for Search (run-v3), short for polling
    const timeoutDuration = endpoint === '/run-v3' ? 15000 : 500;
    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

    try {
      if (endpoint === '/active') { // Only log once for the ping to avoid spam
        console.debug('Fetching:', `${host}${base}${endpoint}`);
        console.debug('Headers:', headers);
      }
      const res = await fetch(`${host}${base}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 403 || res.status === 401) throw new Error("Unauthorized: Invalid API Token");
        throw new Error(`API Error: ${res.status}`);
      }
      if (res.status === 204) return null;
      return await res.json();
    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        console.warn(`Request Timeout: ${endpoint}`);
        // throw new Error("Request Timeout");
      }

      // Soft warning for Auth errors, but keep trying (switch to connected state so controls work)
      if (err.message.includes("Unauthorized")) {
        setStatus('connected');
        console.warn("Auth failed for data fetch, but keeping connection alive for controls.");
        return;
      }
      throw err;
    }
  }, [config]);

  // --- Polling Logic ---

  const stopPolling = () => {
    if (pollInterval.current) {
      clearTimeout(pollInterval.current); // Changed from clearInterval
      pollInterval.current = null;
    }
  };

  const fetchData = useCallback(async () => {
    // Stop if we've already failed too many times
    if (status === 'error_stopped') return;

    try {
      // 1. Check Connection
      await apiCall('/active');

      // If we succeed, reset error tracking
      if (status !== 'connected') {
        setStatus('connected');
        setErrorMsg('');
        errorCount.current = 0;
      }

      // 2. Playback Status
      const playState = await apiCall('/is-playing');
      setIsPlaying(playState?.is_playing || false);

      // 3. Now Playing Info
      const np = await apiCall('/now-playing');
      if (np && np.info) {
        // console.log("Now Playing Info:", np.info); // DEBUG STRUCTURE
        setNowPlaying(np.info);
        setDuration((np.info.durationInMillis || 0) / 1000);

        if (!isSeeking) {
          // [Fix] Debounce: Don't overwrite optimistic seek if we just sought < 8s ago (Increased from 2s->5s->8s)
          const timeSinceSeek = Date.now() - lastSeekTime.current;
          const now = Date.now();
          const delta = (now - lastFetchTimeRef.current) / 1000;
          lastFetchTimeRef.current = now;

          if (timeSinceSeek < 8000) {
            console.log("App: Debouncing Sync. Diff:", timeSinceSeek);
            // [Fix] Optimistic Tick: Keep the clock moving even while ignoring API!
            if (isPlaying) {
              setCurrentTime(prev => prev + delta);
            }
          } else {
            // console.log("App: Syncing Time. Diff:", timeSinceSeek, "New:", np.info.currentPlaybackTime);
            setCurrentTime(np.info.currentPlaybackTime || 0);
          }
        }
      }

      // 4. Volume (Poll every 5th tick ~ 5 seconds)
      if (!isVolumneChanging && pollingTick.current % 5 === 0) {
        const vol = await apiCall('/volume');
        if (vol) {
          setVolume(vol.volume);
          setLocalVolume(vol.volume);
        }
      }

      // 5. Modes (Poll every 5th tick ~ 5 seconds)
      if (pollingTick.current % 5 === 0) {
        try {
          const shuff = await apiCall('/shuffle-mode');
          setShuffleMode(shuff?.value || 0);
          const rep = await apiCall('/repeat-mode');
          setRepeatMode(rep?.value || 0);
        } catch (e) { }
      }

      // Increment tick counter
      pollingTick.current = (pollingTick.current + 1) % 1000;

    } catch (err) {
      // Soft warning for Auth errors, but keep trying (switch to connected state so controls work)
      if (err.message.includes("Unauthorized")) {
        setStatus('connected');
        console.warn("Auth failed for data fetch, but keeping connection alive for controls.");
        return;
      }

      errorCount.current += 1;

      // If errors persist, stop polling to save console
      if (errorCount.current >= MAX_RETRIES) {
        stopPolling();
        setStatus('error_stopped');

        if (window.location.protocol === 'https:' && config.host.startsWith('http:')) {
          setErrorMsg('Blocked by Browser (Mixed Content). Run locally.');
        } else {
          setErrorMsg('Connection Lost. Is Cider running?');
        }
        // Soft error state
        setStatus('error');
      }
    }
  }, [apiCall, isSeeking, isVolumneChanging, config.host, status]);

  // Start/Stop Polling Effect
  useEffect(() => {
    // Clear any existing timer
    stopPolling();

    const loop = async () => {
      if (status === 'error_stopped' || status === 'disconnected') return;

      await fetchData();

      // Schedule next poll ONLY after previous finishes
      pollInterval.current = setTimeout(loop, 1500);
    };

    // Only start polling if we are not in a hard stopped state
    if (status !== 'error_stopped' && status !== 'disconnected') {
      loop(); // Initial call
    }

    return () => stopPolling();
  }, [fetchData, status]);

  // Client-side interpolation for smooth seeker
  useEffect(() => {
    let interval = null;
    if (isPlaying && !isSeeking) {
      interval = setInterval(() => {
        setCurrentTime(prev => {
          // Don't exceed duration
          if (prev >= duration) return prev;
          return prev + 0.1; // Increment by 100ms
        });
      }, 100);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, isSeeking, duration]);

  // Retry Connection Action
  const retryConnection = () => {
    errorCount.current = 0;
    setStatus('connecting');
    setErrorMsg('');
    fetchData(); // Will trigger the useEffect to restart interval
  };



  // --- Actions ---

  const handlePlayPause = async () => {
    if (remoteControls) {
      if (isPlaying) remoteControls.pause();
      else remoteControls.play();
      return;
    }
    setIsPlaying(!isPlaying); // Optimistic
    try { await apiCall('/playpause', 'POST'); }
    catch (e) { setIsPlaying(isPlaying); }
  };

  const handleNext = async () => {
    if (remoteControls) {
      remoteControls.next();
      return;
    }
    apiCall('/next', 'POST');
  };

  const handlePrev = async () => {
    if (remoteControls) {
      remoteControls.prev();
      return;
    }
    apiCall('/previous', 'POST');
  };



  const handleSeekStart = () => {
    // console.log("App: Phantom Hand? (Seek Start)");
    setIsSeeking(true);
    stopPolling();
  };

  const handleSeekChange = (val) => {
    // setIsSeeking(true); // Removed to prevent race condition
    if (Date.now() - lastSeekTime.current > 100) {
      setSeekValue(val);
    }
  };

  const handleSeekCommit = async () => {
    // console.log("App: Phantom Hand? (Seek Commit) Value:", seekValue);
    lastSeekTime.current = Date.now(); // [Fix] Start debounce
    setCurrentTime(seekValue); // [Fix] Optimistic Update (Critical for Master Broadcast)
    setIsSeeking(false);

    if (remoteControls) {
      remoteControls.seek(seekValue);
      return;
    }
    try { await apiCall('/seek', 'POST', { position: seekValue }); }
    catch (e) { console.error("Seek failed", e); }
  };

  // [Fix] Global release listener to prevent stuck seeker
  useEffect(() => {
    if (isSeeking) {
      const onGlobalRelease = () => handleSeekCommit();
      window.addEventListener('mouseup', onGlobalRelease);
      window.addEventListener('touchend', onGlobalRelease);
      return () => {
        window.removeEventListener('mouseup', onGlobalRelease);
        window.removeEventListener('touchend', onGlobalRelease);
      };
    }
  }, [isSeeking, handleSeekCommit]);

  const handleVolumeChange = (val) => {
    setIsVolumeChanging(true);
    setLocalVolume(val);
    setVolume(val);
  };

  const handleVolumeCommit = async () => {
    setIsVolumeChanging(false);
    try { await apiCall('/volume', 'POST', { volume: localVolume }); }
    catch (e) { console.error("Volume set failed", e); }
  };

  const toggleShuffle = async () => {
    const newMode = shuffleMode === 0 ? 1 : 0;
    setShuffleMode(newMode);
    await apiCall('/toggle-shuffle', 'POST');
  };

  const toggleRepeat = async () => {
    let newMode = repeatMode + 1;
    if (newMode > 2) newMode = 0;
    setRepeatMode(newMode);
    await apiCall('/toggle-repeat', 'POST');
  };

  const saveConfig = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const newConfig = {
      host: formData.get('host'),
      token: formData.get('token')
    };
    setConfig(newConfig);
    try {
      localStorage.setItem('cider_config', JSON.stringify(newConfig));
    } catch (err) {
      console.error('Failed to save config to localStorage:', err);
    }
    setShowSettings(false);
    // Hard reset connection
    errorCount.current = 0;
    setStatus('disconnected');
    setTimeout(retryConnection, 500);
  };

  // --- Helpers ---

  const formatTime = (seconds) => {
    if (!seconds && seconds !== 0) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const getArtworkUrl = (url) => {
    if (!url) return null;
    // Handle both Cider and Demo URL formats
    return url.replace('{w}', '600').replace('{h}', '600').replace('640x640sr', '600x600bb');
  };

  // --- Hooks for ListenTogether (must be called before conditional returns) ---

  const ciderStateMemo = useMemo(() => ({
    nowPlaying: nowPlaying,
    isPlaying: isPlaying,
    currentTime: isSeeking ? seekValue : currentTime,
    lastSeekTimeRef: lastSeekTime, // [Fix] Share debounce ref
    lastSeekTimestamp: lastSeekTime.current // [Fix] Trigger immediate broadcast on seek
  }), [nowPlaying, isPlaying, isSeeking, seekValue, currentTime]);

  const onRemoteActionCallback = useCallback(async (action, payload) => {
    try {
      if (action === 'play') {
        await apiCall('/play', 'POST');
      } else if (action === 'pause') {
        await apiCall('/pause', 'POST');
      } else if (action === 'next') {
        await apiCall('/next', 'POST');
      } else if (action === 'previous') {
        await apiCall('/previous', 'POST');
      } else if (action === 'seek') {
        console.log("App: Phantom Hand? (Remote Seek) Payload:", payload);
        lastSeekTime.current = Date.now(); // [Fix] Start debounce for remote seeks too
        setCurrentTime(payload); // Optimistic update to break sync loop
        await apiCall('/seek', 'POST', { position: payload });
      } else if (action === 'search') {
        // Search Strategy

        // Try Apple Music Catalog Search via Cider Proxy (POST /run-v3)
        // Doc: https://cider.sh/docs/client/rpc#post-run-v3
        const term = encodeURIComponent(payload);
        try {
          // We must use POST to /run-v3
          // Path inside body: /v1/catalog/us/search?types=songs&term=...
          const amapiPath = `/v1/catalog/us/search?types=songs&limit=10&term=${term}`;

          const res = await apiCall('/run-v3', 'POST', { path: amapiPath }, '/api/v1/amapi');

          // Response structure: { data: { results: { songs: { data: [...] } } } }
          const data = res.data || res; // handle potential wrapper differences

          if (data && data.results && data.results.songs) {
            return data.results.songs.data.map(song => ({
              id: song.id,
              name: song.attributes.name,
              artistName: song.attributes.artistName,
              albumName: song.attributes.albumName,
              durationInMillis: song.attributes.durationInMillis,
              artwork: {
                url: song.attributes.artwork.url
              }
            }));
          }
          return [];

        } catch (e) {
          console.error("Search API failed", e);
          return [];
        }
      } else if (action === 'play_song') {
        // Standard Play by ID
        console.log("🎯 App: Received play_song action. Payload:", JSON.stringify(payload, null, 2));

        // Prefer catalogId for library songs (universal), fallback to regular id
        // Library IDs (i.xxx) only work in the owner's Cider instance
        const songId = payload.playParams?.catalogId ||
                       payload.catalogId ||
                       payload.id ||
                       payload.playParams?.id;

        if (!songId) {
          console.error("❌ Missing Song ID in play_song payload!", JSON.stringify(payload));
          return;
        }

        console.log("🎯 App: Attempting to play song ID:", songId, "(isLibrary:", payload.playParams?.isLibrary, ")");
        try {
          await apiCall('/play-item', 'POST', {
            type: 'songs',
            id: songId
          });
          console.log("✅ App: Successfully called /play-item for song ID:", songId);
        } catch (e) {
          console.error("❌ Failed to play remote song using /play-item", e);
          // Optional: Try fallback to /play (queue) if strictly needed, but ID play is standard.
        }
      }
    } catch (e) {
      console.error("Remote action failed", e);
    }
  }, [isPlaying, seekValue, currentTime, apiCall, setRemoteControls]);

  // --- Render ---

  if (showSettings || status === 'disconnected') {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex flex-col font-sans">
        {/* Draggable Title Bar - Full width at top */}
        <div className="w-full h-12 flex-shrink-0" style={{ WebkitAppRegion: 'drag' }} />

        <div className="flex items-center justify-center p-4 flex-1">
          <Card className="w-full max-w-md">
            <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
              <Settings className="text-red-500" />
              <h2 className="text-2xl font-bold">Cider Remote Setup</h2>
            </div>

          <form onSubmit={saveConfig} className="space-y-4">
            <div>
              <label className="block text-sm text-neutral-400 mb-1">Host URL</label>
              <input
                name="host"
                defaultValue={config.host}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-3 focus:outline-none focus:border-red-500 text-white"
                placeholder="http://localhost:10767"
              />
            </div>

            <div>
              <label className="block text-sm text-neutral-400 mb-1">API Token (Optional)</label>
              <input
                name="token"
                defaultValue={config.token}
                type="password"
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-3 focus:outline-none focus:border-red-500 text-white"
                placeholder="Paste token from Cider Settings"
              />
            </div>

            {/* Warning Box */}
            <div className="bg-neutral-800 rounded-lg p-4 text-xs text-neutral-400 space-y-2">
              <div className="flex items-center gap-2 text-amber-500 font-bold">
                <AlertTriangle size={14} />
                <span>Troubleshooting</span>
              </div>
              <p>1. Ensure Cider is running.</p>
              <p>2. If on HTTPS, your browser will block local HTTP connections. Look for a shield icon in the address bar to "Allow Insecure Content" or download this file.</p>
            </div>

            <div className="flex gap-3 pt-2">
              {status !== 'disconnected' && (
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => setShowSettings(false)}
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" className="flex-1 bg-red-600 hover:bg-red-700">
                Save & Connect
              </Button>
            </div>
          </form>
        </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-900 to-black text-white flex flex-col font-sans selection:bg-red-500/30">

      {/* Draggable Title Bar - Full width at top */}
      <div className="w-full h-12 flex-shrink-0" style={{ WebkitAppRegion: 'drag' }} />

      {/* Main content area - centered */}
      <div className="flex items-center justify-center p-4 flex-1">
        {/* Background Ambience */}
        {nowPlaying?.artwork?.url && (
          <div
            className="fixed inset-0 opacity-20 blur-3xl pointer-events-none z-0 scale-150 transition-all duration-1000 ease-in-out"
            style={{ backgroundImage: `url(${getArtworkUrl(nowPlaying.artwork.url)})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          />
        )}

        <div className="w-full max-w-md z-10 relative">

          {/* Header */}
          <div className="flex justify-between items-center mb-6 px-2">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full transition-colors duration-500 ${status === 'connected' ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' :
                'bg-red-500 animate-pulse'
                }`} />
              <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                {status === 'connected' ? 'Cider Connected' : 'Disconnected'}
              </span>
            </div>
            <button onClick={() => setShowSettings(true)} className="text-white/40 hover:text-white transition-colors">
              <Settings size={20} />
            </button>
          </div>

        {/* Error Banner (Stopped State) */}
        {status === 'error_stopped' && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-200">Connection Failed</p>
                <p className="text-xs text-red-300/80 mt-1">{errorMsg}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={retryConnection} className="flex-1 bg-red-500/20 border-0 hover:bg-red-500/30 text-red-100">
                <RefreshCw size={14} className="mr-2" /> Retry
              </Button>


            </div>
          </div>
        )}

        {/* Main Player Card */}
        <Card className="backdrop-blur-2xl bg-black/60 border-white/5">

          {/* Artwork */}
          <div className="aspect-square w-full bg-neutral-800 rounded-2xl mb-6 shadow-2xl overflow-hidden relative group border border-white/5">
            {nowPlaying?.artwork ? (
              <img
                src={getArtworkUrl(nowPlaying.artwork.url)}
                alt="Album Art"
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
                <Music size={64} className="text-neutral-700" />
              </div>
            )}

            {/* Status Overlay */}
            {!isPlaying && (status === 'connected') && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-sm transition-opacity">
                <Pause size={48} className="text-white/50" />
              </div>
            )}
          </div>

          {/* Track Info */}
          <div className="text-center mb-8 space-y-1">
            <h1 className="text-2xl font-bold text-white truncate px-2">
              {nowPlaying?.name || "Not Playing"}
            </h1>
            <p className="text-lg text-white/60 truncate px-4">
              {nowPlaying?.artistName || "Cider Client"}
            </p>
            <p className="text-xs text-white/40 font-medium uppercase tracking-widest pt-1">
              {nowPlaying?.albumName || "Waiting for music..."}
            </p>
          </div>

          {/* Seek Bar */}
          <div className="mb-8 px-2">
            <Slider
              value={isSeeking ? seekValue : currentTime}
              max={duration || 100}
              onSeekStart={handleSeekStart}
              onChange={handleSeekChange}
              onCommit={handleSeekCommit}
            />
            <div className="flex justify-between text-xs font-medium text-white/30 mt-2 font-mono">
              <span>{formatTime(isSeeking ? seekValue : currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between mb-8 px-2">
            <Button
              variant="icon"
              onClick={toggleShuffle}
              className={shuffleMode === 1 ? "text-red-500 hover:text-red-400" : "text-white/30"}
              title="Shuffle"
            >
              <Shuffle size={20} />
            </Button>

            <div className="flex items-center gap-4">
              <Button variant="secondary" onClick={handlePrev}>
                <SkipBack size={24} fill="currentColor" />
              </Button>

              <Button variant="primary" onClick={handlePlayPause} className="w-16 h-16 flex items-center justify-center">
                {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
              </Button>

              <Button variant="secondary" onClick={handleNext}>
                <SkipForward size={24} fill="currentColor" />
              </Button>
            </div>

            <Button
              variant="icon"
              onClick={toggleRepeat}
              className={repeatMode > 0 ? "text-red-500 hover:text-red-400" : "text-white/30"}
              title="Repeat"
            >
              <Repeat size={20} className="relative" />
              {repeatMode === 1 && (
                <span className="absolute text-[8px] font-bold top-2 right-1.5">1</span>
              )}
            </Button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-3 px-2 py-2 bg-white/5 rounded-xl">
            <button
              onClick={() => handleVolumeChange(0)}
              className="text-white/50 hover:text-white transition-colors"
            >
              {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <Slider
              value={localVolume}
              max={1}
              onChange={handleVolumeChange}
              onCommit={handleVolumeCommit}
              className="h-1"
            />
            <span className="text-xs font-mono text-white/50 w-8 text-right">
              {Math.round(localVolume * 100)}%
            </span>
          </div>

        </Card>

        {/* Listen Together Integration */}
        <ListenTogether
          isConnected={status === 'connected'}
          setRemoteControls={setRemoteControls}
          ciderState={ciderStateMemo}
          onRemoteAction={onRemoteActionCallback}
          apiCall={apiCall}
        />

        {/* Auto-Update Notification */}
        <UpdateNotification />
      </div>
      </div>
    </div>
  );
}