# Quick Portainer Deployment Guide

## Deploy in 3 Steps

### Step 1: Build the Docker Image (if not using a registry)

On your server, build the image:

```bash
cd /path/to/cider-remote/server
docker build -t cider-remote-server:latest .
```

### Step 2: Create Stack in Portainer

1. Open Portainer web interface
2. Navigate to **Stacks** → **Add stack**
3. Name: `cider-remote-server`
4. Build method: **Web editor**
5. Copy and paste the contents of `portainer-stack.yml`
6. Scroll to **Environment variables** (optional)
7. Click **Deploy the stack**

### Step 3: Verify Deployment

1. Go to **Containers** in Portainer
2. You should see `cider-remote-server` running
3. Click on it to view logs and details
4. Check health status (should show as "healthy" after ~40 seconds)

## Test the Server

```bash
# From any machine that can reach your server
curl http://YOUR_SERVER_IP:3001/health

# Expected response:
# {"status":"healthy","timestamp":"...","uptime":123,"activeRooms":0}
```

## Environment Variables (Optional)

Add these in Portainer's environment variables section if needed:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Port the server listens on |
| `NODE_ENV` | `production` | Node environment |

## Change Port

To use a different port (e.g., 8080):

1. In the stack YAML, change:
   ```yaml
   ports:
     - "8080:3001"
   ```
2. Redeploy the stack

## Using Pre-built Images (Advanced)

If you have a Docker registry:

1. Build and push:
   ```bash
   docker build -t your-registry/cider-remote-server:latest .
   docker push your-registry/cider-remote-server:latest
   ```

2. In `portainer-stack.yml`, replace the `build` section with:
   ```yaml
   image: your-registry/cider-remote-server:latest
   ```

## Common Issues

**Container not starting?**
- Check logs in Portainer: Containers → cider-remote-server → Logs
- Verify port 3001 is not in use: `netstat -tuln | grep 3001`

**Can't connect from client?**
- Check firewall allows port 3001
- Verify server is running: `docker ps | grep cider-remote`
- Test health endpoint: `curl http://localhost:3001/health`

**Health check failing?**
- Give it 40 seconds to start
- Check container logs for errors
- Verify the server started successfully

## Update the Server

1. Rebuild the image:
   ```bash
   docker build -t cider-remote-server:latest /path/to/cider-remote/server
   ```

2. In Portainer:
   - Go to Stacks → cider-remote-server
   - Click **Pull and redeploy** (if using registry)
   - Or click **Editor**, then **Update the stack**

## Need More Details?

See `DEPLOYMENT.md` for:
- Reverse proxy configuration
- Production deployment checklist
- Security considerations
- Advanced networking
- Troubleshooting

## Quick Reference

- **Health endpoint**: `http://localhost:3001/health`
- **Default port**: 3001
- **Container name**: `cider-remote-server`
- **Image name**: `cider-remote-server:latest`
- **Logs location**: Portainer → Containers → cider-remote-server → Logs
