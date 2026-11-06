FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y openssl --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY server server
RUN npm run db:generate && npm run build -w server
USER node
EXPOSE 3001
CMD ["sh", "-c", "npm run db:migrate && exec node server/dist/server.js"]
