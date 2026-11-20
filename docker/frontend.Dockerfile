FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY frontend/package.json ./frontend/

RUN npm install --workspace=frontend

COPY frontend ./frontend

RUN npm run build --workspace=frontend

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./.next/static
COPY --from=builder /app/frontend/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
