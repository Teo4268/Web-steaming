# Sử dụng image Python chuẩn
FROM python:3.10-slim

# Cài đặt các gói cần thiết
RUN apt-get update && apt-get install -y \
    curl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Tạo thư mục app
WORKDIR /app

# Copy file requirements trước
COPY requirements.txt .

# Cài đặt các thư viện Python cần thiết
RUN pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ mã nguồn app vào container
COPY . .

# Chạy ứng dụng
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "10000"]
