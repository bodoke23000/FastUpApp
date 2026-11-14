FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY migrations ./migrations
USER node
EXPOSE 3030
CMD ["node", "server/index.js"]
