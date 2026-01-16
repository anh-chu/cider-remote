# Deployment Guide

## Docker

1. **Build the image**:
   ```bash
   docker build -t cider-remote-server .
   ```

2. **Run the container**:
   ```bash
   docker run -d -p 3001:3001 --name cider-remote-server cider-remote-server
   ```
   
   To use a different port:
   ```bash
   docker run -d -p 8080:8080 -e PORT=8080 --name cider-remote-server cider-remote-server
   ```

## Caddy Configuration

If you are running this behind Caddy (Reverse Proxy), use the following configuration to handle WebSocket connections (supported natively by Caddy).

### Standard Configuration
Assuming Caddy is running on the host or can access localhost:3001.

```caddy
your-domain.com {
    reverse_proxy localhost:3001
}
```

### Docker Network Configuration
If both Caddy and `cider-remote-server` are effectively in the same Docker network:

```caddy
your-domain.com {
    reverse_proxy cider-remote-server:3001
}
```
