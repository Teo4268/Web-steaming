// hub.js
const { WebSocketServer } = require('ws');
const url = require('url');

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

// Cấu trúc dữ liệu chính
// Key: sessionId (string)
// Value: { workerSocket: WebSocket, viewerSockets: Set<WebSocket> }
const sessions = new Map();
const viewers = new Set(); // Lưu tất cả các kết nối viewer

console.log(`[HUB] WebSocket Hub Server đang chạy trên ws://localhost:${PORT}`);

// Hàm gửi danh sách các stream đang hoạt động tới tất cả viewer
function broadcastSessionList() {
    const activeSessions = Array.from(sessions.keys());
    const message = JSON.stringify({
        type: 'SESSIONS_UPDATE',
        data: activeSessions,
    });
    viewers.forEach(viewer => {
        if (viewer.readyState === viewer.OPEN) {
            viewer.send(message);
        }
    });
    console.log(`[HUB] Đã cập nhật danh sách sessions: ${activeSessions.join(', ')}`);
}

wss.on('connection', (ws, req) => {
    const { pathname } = url.parse(req.url, true);
    const parts = pathname.split('/').filter(p => p); // e.g., ['worker', 'my-session-id'] or ['viewer']

    // --- XỬ LÝ KẾT NỐI TỪ WORKER ---
    if (parts.length === 2 && parts[0] === 'worker') {
        const sessionId = parts[1];
        console.log(`[HUB] Worker '${sessionId}' đã kết nối.`);

        if (sessions.has(sessionId)) {
            console.log(`[HUB] SessionId '${sessionId}' đã tồn tại. Đóng kết nối cũ.`);
            sessions.get(sessionId).workerSocket.close(1011, 'New worker connected');
        }

        sessions.set(sessionId, { workerSocket: ws, viewerSockets: new Set() });
        broadcastSessionList(); // Cập nhật danh sách cho tất cả viewer

        ws.on('message', (imageBuffer) => {
            // Chuyển tiếp ảnh đến các viewer đang xem session này
            const session = sessions.get(sessionId);
            if (session) {
                session.viewerSockets.forEach(viewer => {
                    if (viewer.readyState === viewer.OPEN) {
                        viewer.send(imageBuffer);
                    }
                });
            }
        });

        ws.on('close', () => {
            console.log(`[HUB] Worker '${sessionId}' đã ngắt kết nối.`);
            const session = sessions.get(sessionId);
            if (session) {
                // Đóng kết nối của các viewer đang xem
                session.viewerSockets.forEach(v => v.close(1011, 'Stream ended'));
                sessions.delete(sessionId);
                broadcastSessionList(); // Cập nhật lại danh sách
            }
        });
    // --- XỬ LÝ KẾT NỐI TỪ VIEWER ---
    } else if (parts.length === 1 && parts[0] === 'viewer') {
        console.log('[HUB] Một Viewer đã kết nối.');
        viewers.add(ws);
        ws.currentSession = null; // Theo dõi session viewer đang xem

        // Gửi ngay danh sách session hiện tại cho viewer mới
        ws.send(JSON.stringify({
            type: 'SESSIONS_UPDATE',
            data: Array.from(sessions.keys()),
        }));

        ws.on('message', (messageStr) => {
            try {
                const message = JSON.parse(messageStr);
                // Viewer muốn xem một stream cụ thể
                if (message.type === 'SUBSCRIBE' && message.sessionId) {
                    const { sessionId } = message;
                    console.log(`[HUB] Viewer muốn xem session '${sessionId}'.`);

                    // Rời khỏi session cũ (nếu có)
                    if (ws.currentSession && sessions.has(ws.currentSession)) {
                        sessions.get(ws.currentSession).viewerSockets.delete(ws);
                    }
                    
                    // Tham gia session mới
                    if (sessions.has(sessionId)) {
                        sessions.get(sessionId).viewerSockets.add(ws);
                        ws.currentSession = sessionId;
                    }
                }
            } catch (e) { console.error('[HUB] Lỗi xử lý tin nhắn từ viewer:', e); }
        });

        ws.on('close', () => {
            console.log('[HUB] Một Viewer đã ngắt kết nối.');
            // Rời khỏi session đang xem
            if (ws.currentSession && sessions.has(ws.currentSession)) {
                sessions.get(ws.currentSession).viewerSockets.delete(ws);
            }
            viewers.delete(ws);
        });

    } else {
        console.log(`[HUB] Kết nối không hợp lệ: ${pathname}. Đang đóng.`);
        ws.close();
    }
});
