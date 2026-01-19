# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cider Remote is a remote control application for the Cider Apple Music client. It consists of three main components:

1. **React Web App** (`src/`) - Remote control interface built with React, Vite, and TailwindCSS
2. **Electron Desktop App** (`electron/`) - Native desktop wrapper for the web app
3. **Coordinator Server** (`server/`) - Socket.io-based server for "Listen Together" feature

## Development Commands

### Client (Web/Electron)

```bash
# Development (web only)
npm run dev  # or: bun dev

# Development with Electron
npm run electron:dev

# Build for production
npm run build

# Build Electron apps (local build without publishing)
npm run electron:build-mac    # macOS (outputs dmg + zip)
npm run electron:build-win    # Windows (outputs NSIS installer)

# Build and publish to GitHub Releases (requires GH_TOKEN)
npm run electron:publish-mac
npm run electron:publish-win

# Linting
npm run lint
```

### Server (Coordinator)

```bash
cd server

# Production
npm start

# Development (with auto-reload)
npm run dev

# Docker deployment
docker build -t cider-remote-server .
docker run -d -p 3001:3001 cider-remote-server
```

## Architecture

### Client Architecture

**Communication Flow:**
- App.jsx polls Cider RPC API (default: `http://localhost:10767`) every 1.5 seconds
- Uses API token authentication via `apitoken` and `app-token` headers
- Implements optimistic UI updates with debouncing to prevent state conflicts
- Integrates ListenTogether.jsx for synchronized listening sessions

**Key State Management:**
- `App.jsx` manages Cider connection, playback state, and API polling
- `ListenTogether.jsx` manages Socket.io connection, room state, and master/slave coordination
- Shared state flows through `ciderState` prop and `onRemoteAction` callback

**Master/Slave Pattern:**
- In Listen Together mode, one client becomes "Master" (controls Cider)
- Master broadcasts state updates to server every 500ms
- Slave clients relay control actions to Master via server
- Automatic master reassignment when master disconnects

### Server Architecture

**Coordinator Server** (`server/index.js`):
- Express + Socket.io server managing real-time room state
- In-memory state management with room-based isolation
- Handles master role assignment and transfer
- Relays remote actions from slaves to master
- State includes: queue, history, playback info, users, masterId

**Key Events:**
- `join_room` - User joins, server syncs current state
- `master_state_update` - Master broadcasts state (validated by server)
- `remote_action` - Slave sends control request (forwarded to master)
- `transfer_master` - Current master transfers role to another user
- `leave_room` / `disconnect` - Cleanup and master reassignment

### API Integration

**Cider RPC Endpoints Used:**
- `GET /api/v1/playback/active` - Connection check
- `GET /api/v1/playback/is-playing` - Play state
- `GET /api/v1/playback/now-playing` - Current track info
- `POST /api/v1/playback/playpause` - Toggle playback
- `POST /api/v1/playback/seek` - Seek to position
- `POST /api/v1/amapi/run-v3` - Apple Music catalog search (for Listen Together)
- `POST /api/v1/playback/play-item` - Play specific song by ID

## Development Notes

### Important Behaviors

**Seek Debouncing:**
- 8-second debounce after seek operations to prevent phantom syncs
- Optimistic updates applied immediately for responsive UI
- `lastSeekTime` ref shared between App and ListenTogether to coordinate

**Mixed Content Warning:**
- HTTPS-served app cannot connect to HTTP localhost Cider instances
- User must explicitly allow insecure content in browser settings
- Electron build bypasses this with `webSecurity: false`

**Polling Strategy:**
- Smart polling stops after 3 consecutive errors to prevent console spam
- Volume and shuffle/repeat modes polled every 5th tick (~7.5s) to reduce load
- Client-side interpolation provides smooth progress bar between polls

### Configuration Storage

- Client config stored in localStorage as `cider_config` (host, token)
- Server URL stored in localStorage as `cider_remote_url`
- No persistent database - all room state is in-memory

### Vite Development Proxy

The vite.config.js includes a proxy for development that routes `/api` requests to bypass CORS. Configure via environment variable:

```bash
# Create .env file (see .env.example)
VITE_CIDER_HOST=http://localhost:10767
```

The proxy only affects `npm run dev`. Production builds use the host URL configured in app settings.

### Build Output

- Web build: `dist/` directory
- Electron build: `dist_electron/` directory
- Server runs standalone with its own `node_modules`

## Technology Stack

**Frontend:**
- React 18 with hooks
- Vite for bundling
- TailwindCSS for styling
- Lucide React for icons
- Socket.io-client for real-time communication

**Desktop:**
- Electron with CommonJS entry point
- Hidden title bar with custom overlay

**Backend:**
- Node.js + Express
- Socket.io for WebSocket communication
- In-memory state management

**Development:**
- Concurrently for running multiple processes
- Cross-env for environment variables
- Wait-on for service readiness checks

## Auto-Update System

The Electron app includes automatic update functionality powered by `electron-updater`.

### How It Works

- Checks for updates on GitHub Releases automatically on app startup
- Downloads updates in the background when available
- Notifies users with an in-app notification UI
- Allows users to install updates with one click
- Manual check available via floating button in bottom-right corner

### Update Flow

1. **Check**: App checks GitHub Releases on startup (3 seconds delay)
2. **Notify**: If update available, shows notification with version info
3. **Download**: User clicks "Download Update" button
4. **Install**: Once downloaded, user clicks "Install & Restart"
5. **Update**: App quits and installs the new version

### Build Configuration

Auto-updates require specific build targets:
- **Windows**: NSIS installer (not portable.exe)
- **macOS**: DMG + ZIP (supports both Intel and Apple Silicon)

### Publishing Releases

Releases are automatically published via GitHub Actions:

1. **Update Version**: Edit `package.json` and change version (e.g., `"0.3"` → `"0.4"`)

2. **Tag and Push**:
   ```bash
   git commit -am "Bump version to 0.4"
   git tag v0.4
   git push && git push --tags
   ```

3. **Automatic Build**: GitHub Actions automatically:
   - Builds Windows NSIS installer and macOS DMG/ZIP
   - Publishes to GitHub Releases with all update metadata files
   - Existing installations will detect the update automatically

### Testing Updates

Auto-updates only work in packaged production builds, not in development mode. To test:

1. Build and install version 0.3
2. Bump to version 0.4, tag, and push
3. GitHub Actions builds and publishes the release
4. Run the installed 0.3 app - it should detect the update after 3 seconds

### Update Channels

Currently configured for latest/stable channel. Future enhancements could add:
- Beta channel for pre-release testing
- Staged rollouts to percentage of users
- Update scheduling (install on next launch)
