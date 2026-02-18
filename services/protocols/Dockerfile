# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ src/

RUN npm run build

# Stage 2: Production
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist/ dist/

# Cloud Run injects PORT; default to 8082.
ENV PORT=8082
EXPOSE 8082

# Run as non-root for security.
USER node

CMD ["node", "dist/index.js"]
