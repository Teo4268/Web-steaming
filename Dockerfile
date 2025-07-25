# --- Stage 1: Build Stage ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production

# --- Stage 2: Production Stage ---
FROM node:20-alpine
WORKDIR /app

# Sao chép dependencies từ stage 'builder'
COPY --from=builder /app/node_modules ./node_modules

# === THAY ĐỔI Ở ĐÂY ===
# Sao chép cả package.json VÀ mã nguồn ứng dụng
COPY package.json hub.js ./
# ========================

EXPOSE 8080

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Lệnh để chạy ứng dụng khi container khởi động
CMD ["npm", "start"]
