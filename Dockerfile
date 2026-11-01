FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/web/package.json ./apps/web/
RUN npm install

FROM deps AS builder
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core ./packages/core
COPY --from=builder /app/apps/web ./apps/web
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["npm", "--workspace=@aegis/web", "run", "start"]

