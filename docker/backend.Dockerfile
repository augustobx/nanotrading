FROM node:22-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json ./
COPY backend/package.json ./backend/

# Install dependencies
RUN npm install

# Copy backend source
COPY backend ./backend

# Build backend TypeScript
RUN npm run build --workspace=backend

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV TIMEZONE=America/Argentina/Buenos_Aires

COPY --from=builder /app/package.json ./
COPY --from=builder /app/backend/package.json ./backend/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./backend/dist

EXPOSE 3001

CMD ["node", "backend/dist/index.js"]
