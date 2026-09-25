# WhatsApp sender — a long-running container, not a serverless function.
#
# whatsapp-web.js drives a real WhatsApp Web session in Chromium, so this needs
# three things a request-scoped platform cannot give it: a process that stays
# alive between sends, a writable disk to keep the session keys (scan the QR
# once, not every time), and ~300 MB of browser. Hence a container with a
# mounted volume — see fly.toml.

FROM node:20-slim

# Chromium and the fonts it needs. Installing the distro browser is smaller and
# far more reliable than letting Puppeteer download its own.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-color-emoji \
      ca-certificates \
      dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer must use the system Chromium, and must not fetch its own.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=3001

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# The session keys live on the mounted volume, so a redeploy does not log out.
ENV WA_SESSION_PATH=/data/.wwebjs_auth
RUN mkdir -p /data

EXPOSE 3001

# dumb-init reaps the zombie Chromium processes Puppeteer leaves behind.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
