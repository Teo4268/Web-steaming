# server_optimized.py

import asyncio
from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import HTMLResponse
from starlette.websockets import WebSocketDisconnect
from typing import Dict, Set
import uvicorn
import logging

# --- Cấu hình ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')

# --- Khởi tạo FastAPI ---
app = FastAPI()

# --- Cấu trúc dữ liệu quản lý session ---
# Sử dụng typing để code rõ ràng hơn
class ConnectionManager:
    def __init__(self):
        # sessionId -> { worker: WebSocket | None, viewers: Set[WebSocket] }
        self.sessions: Dict[str, Dict] = {}

    def get_active_sessions(self):
        return list(self.sessions.keys())

    async def connect_viewer(self, websocket: WebSocket):
        await websocket.accept()
        # Ban đầu, viewer chưa thuộc session nào
        # Chúng ta sẽ thêm họ vào một tập hợp tạm thời để có thể gửi danh sách session
        if "viewers_pending" not in self.sessions:
            self.sessions["viewers_pending"] = {"worker": None, "viewers": set()}
        self.sessions["viewers_pending"]["viewers"].add(websocket)
        await self.broadcast_session_list()


    async def disconnect_viewer(self, websocket: WebSocket):
        # Xóa viewer khỏi tất cả các session họ có thể đã tham gia
        for session_id, session_data in self.sessions.items():
            if websocket in session_data["viewers"]:
                session_data["viewers"].remove(websocket)
                logging.info(f"Viewer disconnected from session '{session_id}'")
                break

    async def connect_worker(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        # Nếu session chưa có, tạo mới
        if session_id not in self.sessions:
            self.sessions[session_id] = {"worker": None, "viewers": set()}
        # Đóng worker cũ nếu có
        if self.sessions[session_id].get("worker"):
            await self.sessions[session_id]["worker"].close(code=1012, reason="New worker connected")
        
        self.sessions[session_id]["worker"] = websocket
        logging.info(f"Worker connected for session '{session_id}'")
        await self.broadcast_session_list()

    def disconnect_worker(self, session_id: str):
        if session_id in self.sessions:
            # Không xóa ngay, giữ lại để viewer có thể còn đó
            self.sessions[session_id]["worker"] = None
            logging.info(f"Worker disconnected for session '{session_id}'")
            # Có thể thông báo cho viewer rằng stream đã tạm dừng
            # self.broadcast_to_viewers(session_id, {"type": "status", "message": "Stream paused"})
        

    async def subscribe_viewer_to_session(self, websocket: WebSocket, session_id: str):
        # Rời session cũ
        await self.disconnect_viewer(websocket)
        
        # Tham gia session mới
        if session_id in self.sessions:
            self.sessions[session_id]["viewers"].add(websocket)
            logging.info(f"Viewer subscribed to session '{session_id}'")
        else:
            logging.warning(f"Viewer tried to subscribe to non-existent session '{session_id}'")
    
    async def broadcast_to_viewers(self, session_id: str, data: bytes):
        if session_id in self.sessions:
            # Dùng asyncio.gather để gửi song song, không đợi client chậm
            # Đây là cách xử lý backpressure cơ bản
            tasks = []
            for viewer in self.sessions[session_id]["viewers"]:
                tasks.append(viewer.send_bytes(data))
            await asyncio.gather(*tasks, return_exceptions=True) # return_exceptions để không bị sập nếu 1 client lỗi

    async def broadcast_session_list(self):
        session_list = self.get_active_sessions()
        message = {"type": "SESSIONS_UPDATE", "data": [sid for sid in session_list if sid != "viewers_pending"]}
        
        all_viewers = set()
        for session_data in self.sessions.values():
            all_viewers.update(session_data["viewers"])

        tasks = [viewer.send_json(message) for viewer in all_viewers]
        await asyncio.gather(*tasks, return_exceptions=True)
        logging.info(f"Broadcasted session list: {message['data']}")


manager = ConnectionManager()

# --- HTML Viewer (đã được tối ưu) ---
html = """
<!DOCTYPE html>
<html>
<head>
    <title>FastAPI Stream Viewer</title>
    <style>
        body { font-family: sans-serif; display: grid; grid-template-columns: 250px 1fr; height: 100vh; margin: 0; }
        #sidebar { padding: 1rem; border-right: 1px solid #ccc; overflow-y: auto; }
        #stream-list button { display: block; width: 100%; padding: 0.5rem; margin-bottom: 0.5rem; cursor: pointer; }
        #stream-list button.active { background-color: dodgerblue; color: white; }
        #main { background: black; display: flex; align-items: center; justify-content: center; }
        img { max-width: 100%; max-height: 100%; object-fit: contain; }
    </style>
</head>
<body>
    <div id="sidebar">
        <h3>Active Streams</h3>
        <div id="stream-list"></div>
    </div>
    <div id="main">
        <img id="screen" />
    </div>
    <script>
        const img = document.getElementById("screen");
        const streamList = document.getElementById("stream-list");
        const wsProtocol = location.protocol === "https:" ? "wss://" : "ws://";
        
        // --- WebSocket cho Viewer ---
        const viewWs = new WebSocket(wsProtocol + location.host + "/view");
        
        viewWs.onmessage = e => {
            if (e.data instanceof Blob) {
                // Xử lý dữ liệu ảnh nhị phân
                img.src = URL.createObjectURL(e.data);
                img.onload = () => URL.revokeObjectURL(img.src); // Giải phóng bộ nhớ
            } else {
                // Xử lý tin nhắn control (JSON)
                const msg = JSON.parse(e.data);
                if (msg.type === 'SESSIONS_UPDATE') {
                    updateStreamList(msg.data);
                }
            }
        };

        function updateStreamList(sessions) {
            streamList.innerHTML = '';
            sessions.forEach(sid => {
                const btn = document.createElement('button');
                btn.textContent = sid;
                btn.onclick = () => {
                    viewWs.send(JSON.stringify({ type: "SUBSCRIBE", sessionId: sid }));
                    // Đánh dấu nút active
                    document.querySelectorAll('#stream-list button').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                };
                streamList.appendChild(btn);
            });
        }
    </script>
</body>
</html>
"""

@app.get("/")
async def get():
    return HTMLResponse(html)

# Endpoint cho Worker gửi dữ liệu
@app.websocket("/worker/{session_id}")
async def ws_worker_endpoint(websocket: WebSocket, session_id: str):
    await manager.connect_worker(websocket, session_id)
    try:
        while True:
            # Nhận dữ liệu dưới dạng bytes
            data = await websocket.receive_bytes()
            # Chuyển tiếp cho các viewer của session này
            await manager.broadcast_to_viewers(session_id, data)
    except WebSocketDisconnect:
        manager.disconnect_worker(session_id)

# Endpoint cho Viewer kết nối và nhận dữ liệu
@app.websocket("/view")
async def ws_viewer_endpoint(websocket: WebSocket):
    await manager.connect_viewer(websocket)
    try:
        while True:
            # Viewer gửi yêu cầu subscribe
            data = await websocket.receive_json()
            if data.get("type") == "SUBSCRIBE" and data.get("sessionId"):
                await manager.subscribe_viewer_to_session(websocket, data["sessionId"])
    except WebSocketDisconnect:
        await manager.disconnect_viewer(websocket)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=10000)
