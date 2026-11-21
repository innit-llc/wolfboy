FROM node:22-slim

WORKDIR /srv/book-club
COPY package.json tsconfig.json PRIVACY.md ./
RUN npm install
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production DB_FILE=/data/book-club.sqlite
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/server.js"]
