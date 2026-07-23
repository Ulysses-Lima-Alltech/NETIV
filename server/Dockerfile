# Build só o backend (tsc). Evita `vite build`/esbuild no Alpine (erro de versão host/binary).
FROM node:22-alpine AS builder
WORKDIR /app

COPY server/package*.json ./
RUN npm ci

COPY server/ ./
RUN npm run build \
  && rm -rf dist/tests dist/scripts

FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY server/package*.json ./
RUN npm ci --omit=dev \
  && find node_modules -type d \( -name test -o -name tests -o -name __tests__ \) \
    -prune -exec rm -rf '{}' + \
  && find node_modules -type f \( -name '*.test.js' -o -name '*.test.ts' \
    -o -name '*.spec.js' -o -name '*.spec.ts' \) -delete

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/db ./db
COPY public/data ./public/data

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
