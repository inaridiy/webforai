# AUTO-GENERATED. DO NOT EDIT.
FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
# Install deps (only externals declared via plugin options)
COPY package.json ./
RUN corepack enable && pnpm install --prod --no-frozen-lockfile
# Server bundle
COPY ./server.mjs ./server.mjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "./server.mjs"]