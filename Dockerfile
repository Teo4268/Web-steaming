# Use official Python image
FROM python:3.11-slim

# Set work directory


# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Expose port
EXPOSE 10000

# Start server
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "10000"]
