# server.py
import asyncio
import base64
from fastapi import FastAPI, WebSocket
from fastapi.responses import StreamingResponse, FileResponse
from starlette.websockets import WebSocketDisconnect
import uvicorn
from io import BytesIO
import threading

app = FastAPI()
latest_frame = None

@app.get("/")
async def homepage():
    return FileResponse("client/index.html")

@app.get("/mjpeg")
async def mjpeg_stream():
    async def generate():
        global latest_frame
        while True:
            if latest_frame:
                frame_bytes = base64.b64decode(latest_frame)
                yield (b"--frame\r\n"
                       b"Content-Type: image/jpeg\r\n\r\n" +
                       frame_bytes + b"\r\n")
            await asyncio.sleep(1 / 30)  # 30 FPS
    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.websocket("/ws")
async def receive_frame(websocket: WebSocket):
    await websocket.accept()
    global latest_frame
    try:
        while True:
            data = await websocket.receive_text()
            latest_frame = data
    except WebSocketDisconnect:
        pass

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=10000)
