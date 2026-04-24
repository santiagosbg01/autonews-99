FROM node:20-slim

# Dependencias del sistema para Baileys
RUN apt-get update && apt-get install -y \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

# auth_state se restaura desde Supabase Storage al arrancar
RUN mkdir -p auth_state logs

CMD ["node", "src/index.js"]
