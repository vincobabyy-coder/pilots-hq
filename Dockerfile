# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY core/ ./core/
COPY engines/ ./engines/
COPY api/ ./api/
COPY db/ ./db/
RUN npm run build

# Stage 2: production
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY db/migrations ./db/migrations
EXPOSE 3000
USER node
CMD ["node", "dist/api/index.js"]
