# Build só o backend (tsc). Evita `vite build`/esbuild no Alpine (erro de versão host/binary).
FROM node:22-alpine AS builder
WORKDIR /app

COPY server/package*.json ./
RUN npm ci

COPY server/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/db ./db
COPY --from=builder /app/scripts ./scripts
COPY public/data ./public/data

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
