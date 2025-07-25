// hub.js - Optimized for High-FPS, Low-Latency Streaming
const { WebSocketServer } = require('ws');
const url = require('url');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// --- Cấu hình ---
// Ngưỡng dữ liệu chờ (tính bằng byte) trước khi bắt đầu bỏ frame cho một client.
// 1MB là một giá trị an toàn, tránh để bộ nhớ đệm của một client chậm làm ảnh hưởng đến server.
const BACKPRESSURE_THRESHOLD = 1 * 1024 * 1024; // 1 MB

/**
 * Cấu trúc dữ liệu quản lý các session
 * @type {Map<string, { workerSocket: import('ws'), viewerSockets: Set<import('ws')> }>}
 */
const sessions = new Map();

/**
 * Tập hợp tất cả các kết nối của viewer
 * @type {Set<import('ws')>}
 */
const viewers = new Set();

console.log(`[HUB] WebSocket Hub Server is running on port ${PORT}`);

// Hàm gửi danh sách các session đang hoạt động tới tất cả viewer
function broadcastSessionList() {
    const activeSessionIds = Array.from(sessions.keys());
    const message = JSON.stringify({
        type: 'SESSIONS_UPDATE',
        data: activeSessionIds,
    });

    viewers.forEach(viewerWs => {
        if (viewerWs.readyState === viewerWs.OPEN) {
            viewerWs.send(message);
        }
    });
    console.log(`[HUB] Broadcasted active sessions: [${activeSessionIds.join(', ')}]`);
}

wss.on('connection', (ws, req) => {
    const { pathname } = url.parse(req.url, true);
    const parts = pathname.split('/').filter(Boolean); // e.g., ['worker', 'session-id'] or ['viewer']

    // --- XỬ LÝ KẾT NỐI TỪ WORKER ---
    if (parts.length === 2 && parts[0] === 'worker') {
        const sessionId = parts[1];
        console.log(`[HUB] Worker '${sessionId}' connected.`);

        // Nếu đã có worker cho session này, đóng kết nối cũ
        if (sessions.has(sessionId)) {
            console.log(`[HUB] Session '${sessionId}' already exists. Closing old worker connection.`);
            sessions.get(sessionId).workerSocket.close(1012, 'New worker connected');
        }

        sessions.set(sessionId, { workerSocket: ws, viewerSockets: new Set() });
        broadcastSessionList(); // Cập nhật danh sách cho tất cả viewer

        ws.on('message', (messageData) => {
            const session = sessions.get(sessionId);
            if (!session) return;

            let imageBuffer;
            // Tối ưu: Nhận cả base64 string hoặc binary buffer từ worker
            if (typeof messageData === 'string') {
                // Nếu worker gửi base64, chuyển đổi nó thành Buffer để gửi đi dưới dạng binary
                imageBuffer = Buffer.from(messageData, 'base64');
            } else {
                // Nếu worker gửi binary, dùng trực tiếp
                imageBuffer = messageData;
            }

            // Chuyển tiếp frame tới tất cả các viewer đang xem session này
            session.viewerSockets.forEach(viewerWs => {
                if (viewerWs.readyState === viewerWs.OPEN) {
                    // Tối ưu Backpressure: Nếu client bị chậm, bỏ qua frame
                    if (viewerWs.bufferedAmount > BACKPRESSURE_THRESHOLD) {
                        // console.warn(`[HUB] High backpressure for viewer on session '${sessionId}'. Dropping frame.`);
                        return;
                    }
                    // Gửi dữ liệu dưới dạng nhị phân để tối ưu băng thông
                    viewerWs.send(imageBuffer, { binary: true });
                }
            });
        });

        ws.on('close', () => {
            console.log(`[HUB] Worker '${sessionId}' disconnected.`);
            const session = sessions.get(sessionId);
            if (session) {
                // Đóng kết nối của các viewer đang xem và thông báo
                session.viewerSockets.forEach(v => v.close(1011, 'Stream ended by worker'));
                sessions.delete(sessionId);
                broadcastSessionList(); // Cập nhật lại danh sách
            }
        });

    // --- XỬ LÝ KẾT NỐI TỪ VIEWER ---
    } else if (parts.length === 1 && parts[0] === 'viewer') {
        console.log('[HUB] A Viewer connected.');
        viewers.add(ws);
        ws.currentSessionId = null; // Theo dõi session viewer đang xem

        // Gửi ngay danh sách session hiện tại cho viewer mới
        ws.send(JSON.stringify({
            type: 'SESSIONS_UPDATE',
            data: Array.from(sessions.keys()),
        }));

        ws.on('message', (messageStr) => {
            // Viewer chỉ gửi tin nhắn control dạng text/JSON
            if (typeof messageStr !== 'string') return;
            
            try {
                const message = JSON.parse(messageStr);
                // Viewer muốn xem một stream cụ thể
                if (message.type === 'SUBSCRIBE' && message.sessionId) {
                    const { sessionId } = message;
                    console.log(`[HUB] Viewer wants to subscribe to session '${sessionId}'.`);

                    // Rời khỏi session cũ (nếu có)
                    if (ws.currentSessionId && sessions.has(ws.currentSessionId)) {
                        sessions.get(ws.currentSessionId).viewerSockets.delete(ws);
                    }
                    
                    // Tham gia session mới
                    if (sessions.has(sessionId)) {
                        sessions.get(sessionId).viewerSockets.add(ws);
                        ws.currentSessionId = sessionId;
                    } else {
                        console.warn(`[HUB] Viewer tried to subscribe to non-existent session '${sessionId}'.`);
                        ws.currentSessionId = null;
                    }
                }
            } catch (e) { console.error('[HUB] Invalid JSON from viewer:', e); }
        });

        ws.on('close', () => {
            console.log('[HUB] A Viewer disconnected.');
            if (ws.currentSessionId && sessions.has(ws.currentSessionId)) {
                sessions.get(ws.currentSessionId).viewerSockets.delete(ws);
            }
            viewers.delete(ws);
        });

    } else {
        console.log(`[HUB] Invalid connection path: ${pathname}. Closing.`);
        ws.close();
    }

    ws.on('error', (err) => {
        console.error('[HUB] WebSocket error:', err);
    });
});
