# Cider Remote Server Deployment Guide

This guide covers deploying the Cider Remote Coordinator Server using Docker and Portainer.

## Quick Start

### Using Docker Compose (Recommended for Portainer)

1. **Build the Docker image:**
   ```bash
   cd server
   docker build -t cider-remote-server:latest .
   ```

2. **Deploy with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

3. **Check status:**
   ```bash
   docker-compose ps
   docker-compose logs -f
   ```

## Portainer Deployment

### Method 1: Using Portainer Stacks (Recommended)

1. Navigate to **Stacks** in Portainer
2. Click **Add stack**
3. Name your stack (e.g., `cider-remote-server`)
4. **Build Method** option:
   - Repository: Upload the `server` folder or use git repository
   - Build method: `docker-compose.yml`
5. Paste the contents of `docker-compose.yml` in the web editor
6. Configure environment variables (see below)
7. Click **Deploy the stack**

### Method 2: Using Portainer Containers

1. Build image locally or use CI/CD:
   ```bash
   docker build -t cider-remote-server:latest server/
   ```

2. In Portainer:
   - Go to **Containers** → **Add container**
   - Name: `cider-remote-server`
   - Image: `cider-remote-server:latest`
   - Port mapping: `3001:3001`
   - Add environment variables (see below)
   - Restart policy: `Unless stopped`
   - Deploy

## Environment Variables

### Required Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server listening port |
| `NODE_ENV` | `production` | Node environment (development/production) |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGIN` | `*` | CORS allowed origins (not currently implemented) |
| `CORS_METHODS` | `GET,POST` | CORS allowed methods (not currently implemented) |
| `LOG_LEVEL` | `info` | Logging level (not currently implemented) |
| `NODE_OPTIONS` | `--max-old-space-size=512` | Node.js runtime options |

### Example .env File

Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

Edit the values as needed for your deployment.

## Portainer Stack Configuration Example

For Portainer Stacks, use this `docker-compose.yml` configuration:

```yaml
version: '3.8'

services:
  cider-remote-server:
    image: cider-remote-server:latest
    container_name: cider-remote-server
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - cider-network

networks:
  cider-network:
    driver: bridge
```

## Health Check

The server exposes a health check endpoint at `/health`:

```bash
curl http://localhost:3001/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-17T12:00:00.000Z",
  "uptime": 3600,
  "activeRooms": 5
}
```

## Resource Limits

The default configuration includes:

- **CPU Limit**: 0.5 cores
- **Memory Limit**: 512 MB
- **CPU Reservation**: 0.1 cores
- **Memory Reservation**: 128 MB

Adjust these in `docker-compose.yml` under `deploy.resources` based on your needs.

## Networking

### Port Configuration

The server listens on port `3001` by default. To change:

1. Update the `PORT` environment variable
2. Update the port mapping in `docker-compose.yml`:
   ```yaml
   ports:
     - "YOUR_PORT:YOUR_PORT"
   ```

### Reverse Proxy (Recommended for Production)

For production deployments, use a reverse proxy (nginx, Traefik, Caddy):

**Example nginx configuration:**
```nginx
server {
    listen 80;
    server_name cider-remote.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**For WebSocket support (Socket.io)**, ensure your reverse proxy supports WebSocket upgrades (shown in example above).

## Logs

### View logs in Docker:
```bash
docker-compose logs -f
```

### View logs in Portainer:
1. Go to **Containers**
2. Click on `cider-remote-server`
3. Click **Logs**

### Log Rotation

Logs are automatically rotated with these settings:
- Max file size: 10 MB
- Max files: 3

## Troubleshooting

### Container won't start

1. Check logs: `docker-compose logs`
2. Verify port 3001 is not already in use:
   ```bash
   netstat -tuln | grep 3001
   ```
3. Check environment variables are set correctly

### Health check failing

1. Verify the server is responding:
   ```bash
   docker exec cider-remote-server node -e "require('http').get('http://localhost:3001/health', r => r.on('data', d => console.log(d.toString())))"
   ```

2. Check if the port is accessible from inside the container:
   ```bash
   docker exec cider-remote-server wget -O- http://localhost:3001/health
   ```

### Cannot connect from client

1. Verify the server is running:
   ```bash
   docker-compose ps
   ```

2. Check firewall rules allow port 3001

3. If using a reverse proxy, verify WebSocket upgrade headers are set

4. Check CORS settings (currently set to allow all origins)

## Updating

### Update the server:

```bash
# Pull latest code
cd server
git pull

# Rebuild image
docker-compose build

# Restart with new image
docker-compose up -d

# Clean up old images
docker image prune -f
```

### In Portainer:

1. Go to **Stacks**
2. Select your stack
3. Click **Pull and redeploy**

Or for containers:
1. Stop the container
2. Remove the container
3. Rebuild/pull the image
4. Create a new container with the same configuration

## Backup

The server stores all state in memory. To persist room state across restarts, you would need to implement state persistence (not currently available).

## Security Considerations

1. **CORS**: Currently set to allow all origins (`*`). For production, restrict to your domain.
2. **Reverse Proxy**: Use HTTPS in production with a reverse proxy.
3. **Network**: Use Docker networks to isolate the server from other containers.
4. **Updates**: Keep the base image and dependencies updated.

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure reverse proxy with HTTPS
- [ ] Restrict CORS to your domain (requires code modification)
- [ ] Set up monitoring and alerting
- [ ] Configure backup strategy if needed
- [ ] Set resource limits appropriate for your load
- [ ] Enable firewall rules
- [ ] Set up log aggregation if running multiple instances
- [ ] Document your deployment configuration

## Support

For issues or questions:
- Check server logs first
- Review this deployment guide
- Check the main repository README
- Open an issue on GitHub
