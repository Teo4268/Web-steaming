// hub.js - Back to Basics Edition
const { WebSocketServer } = require('ws');
const url = require('url');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const sessions = new Map(); // sessionId -> { worker: ws, viewers: Set<ws> }

console.log(`[HUB] Simple Relay Server is running on port ${PORT}`);

function broadcastSessionListToAllViewers() {
    const activeSessionIds = Array.from(sessions.keys());
    const message = JSON.stringify({
        type: 'SESSIONS_UPDATE',
        data: activeSessionIds,
    });
    // Lặp qua tất cả các session và gửi cho viewer của mỗi session
    for (const session of sessions.values()) {
        session.viewers.forEach(viewer => {
            if (viewer.readyState === viewer.OPEN) {
                viewer.send(message);
            }
        });
    }
    // Gửi cho cả các viewer chưa đăng ký session nào (nếu có)
    // Cách này không hiệu quả lắm nhưng đơn giản, sẽ tối ưu sau.
}

wss.on('connection', (ws, req) => {
    const { pathname } = url.parse(req.url, true);
    const parts = pathname.split('/').filter(Boolean);

    // Kết nối từ Worker: /worker/session-id
    if (parts[0] === 'worker' && parts[1]) {
        const sessionId = parts[1];
        console.log(`[HUB] Worker '${sessionId}' connected.`);

        // Đóng worker cũ nếu có
        if (sessions.has(sessionId)) {
            sessions.get(sessionId).worker.close(1012, 'New worker took over.');
        }

        // Tạo session mới
        sessions.set(sessionId, { worker: ws, viewers: new Set() });

        ws.on('message', (data) => {
            const session = sessions.get(sessionId);
            if (session) {
                // Chuyển tiếp dữ liệu cho tất cả viewer
                session.viewers.forEach(viewer => {
                    // Không cần kiểm tra backpressure cho sự đơn giản
                    if (viewer.readyState === viewer.OPEN) {
                        viewer.send(data);
                    }
                });
            }
        });

        ws.on('close', () => {
            console.log(`[HUB] Worker '${sessionId}' disconnected.`);
            const session = sessions.get(sessionId);
            if (session) {
                session.viewers.forEach(viewer => viewer.close(1011, 'Stream ended.'));
                sessions.delete(sessionId);
            }
        });

    // Kết nối từ Viewer: /viewer
    } else if (parts[0] === 'viewer') {
        console.log('[HUB] A Viewer connected.');
        ws.isViewer = true;

        ws.on('message', (messageStr) => {
            try {
                const message = JSON.parse(messageStr);
                if (message.type === 'SUBSCRIBE' && message.sessionId) {
                    const { sessionId } = message;
                    
                    // Rời session cũ
                    if (ws.currentSessionId && sessions.has(ws.currentSessionId)) {
                        sessions.get(ws.currentSessionId).viewers.delete(ws);
                    }

                    // Tham gia session mới
                    if (sessions.has(sessionId)) {
                        sessions.get(sessionId).viewers.add(ws);
                        ws.currentSessionId = sessionId;
                        console.log(`[HUB] Viewer subscribed to '${sessionId}'`);
                    }
                }
            } catch (e) { /* ignore */ }
        });
        
        // Gửi danh sách session ban đầu
        ws.send(JSON.stringify({ type: 'SESSIONS_UPDATE', data: Array.from(sessions.keys()) }));

        ws.on('close', () => {
             console.log('[HUB] A Viewer disconnected.');
             if (ws.currentSessionId && sessions.has(ws.currentSessionId)) {
                sessions.get(ws.currentSessionId).viewers.delete(ws);
             }
        });

    } else {
        ws.close();
    }
});
