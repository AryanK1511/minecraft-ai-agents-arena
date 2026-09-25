FROM node:26.8.1-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY agents ./agents
COPY dashboard ./dashboard
RUN npm run build && npm test
FROM node:26.8.1-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/dashboard/dist ./dashboard/dist
COPY agents ./agents
COPY shared/prompts ./shared/prompts
COPY shared/minecraft-rules ./shared/minecraft-rules
COPY shared/house-requirements ./shared/house-requirements
EXPOSE 3000
CMD ["node", "dist/src/server/index.js"]
