FROM node:22-alpine

WORKDIR /app

COPY battle-server/package.json battle-server/package-lock.json ./

RUN npm ci

COPY battle-server/src ./src

EXPOSE 3001

CMD ["node", "src/index.js"]
