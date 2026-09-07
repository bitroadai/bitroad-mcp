FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
ENTRYPOINT ["node", "bin/bitroad-mcp.js"]
