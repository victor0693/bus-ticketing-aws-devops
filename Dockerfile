FROM node:18-alpine

WORKDIR /app

# Copy dependency manifests first so Docker can cache the npm install layer
# separately from your source code — speeds up rebuilds a lot once you're
# iterating on app.js without changing dependencies.
COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "app.js"]
