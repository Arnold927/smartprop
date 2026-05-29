// utils/websocket.ts
class TimeTrackingWebSocket {
  private ws: WebSocket | null = null;
  private callbacks: Map<string, Function[]> = new Map();

  connect() {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const callbacks = this.callbacks.get(data.type) || [];
      callbacks.forEach(callback => callback(data.payload));
    };

    this.ws.onclose = () => {
      setTimeout(() => this.connect(), 3000); // Reconnect after 3 seconds
    };
  }

  subscribe(type: string, callback: Function) {
    if (!this.callbacks.has(type)) {
      this.callbacks.set(type, []);
    }
    this.callbacks.get(type)?.push(callback);
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.callbacks.get(type) || [];
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    };
  }

  send(type: string, payload: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }
}

export const timeTrackingSocket = new TimeTrackingWebSocket();
