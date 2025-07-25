# --- Stage 1: Build Stage ---
# Sử dụng một image Node.js đầy đủ để cài đặt dependencies
# Chọn phiên bản LTS (Long Term Support) như 20 để có sự ổn định
FROM node:20-alpine AS builder

# Thiết lập thư mục làm việc trong container
WORKDIR /app

# Sao chép package.json và package-lock.json vào container
# Điều này tận dụng Docker layer caching. Docker sẽ chỉ chạy lại npm install
# nếu các file này thay đổi.
COPY package*.json ./

# Cài đặt chỉ các dependencies cần thiết cho production
RUN npm install --only=production

# --- Stage 2: Production Stage ---
# Sử dụng một image Node.js siêu nhẹ cho môi trường production
# 'alpine' là một bản phân phối Linux nhỏ gọn, lý tưởng cho container
FROM node:20-alpine

# Thiết lập thư mục làm việc
WORKDIR /app

# Sao chép các dependencies đã được cài đặt từ stage 'builder'
COPY --from=builder /app/node_modules ./node_modules

# Sao chép mã nguồn ứng dụng của bạn
COPY hub.js ./

# Mở cổng 8080 để cho phép kết nối từ bên ngoài vào container
EXPOSE 8080

# Thiết lập người dùng không phải root để tăng cường bảo mật
# Tạo một user và group tên là 'node'
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Lệnh để chạy ứng dụng khi container khởi động
# Sử dụng "npm start" như đã định nghĩa trong package.json
CMD ["npm", "start"]
