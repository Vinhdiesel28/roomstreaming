import { LoaderCircle, Server } from "lucide-react";

interface Props {
  rejoining: boolean;
  roomCode: string;
}

export function ServerWakeScreen({ rejoining, roomCode }: Props) {
  return (
    <main className="server-wake" aria-live="polite" aria-busy="true">
      <span className="server-wake__icon" aria-hidden="true">
        <Server size={28} />
        <LoaderCircle className="spin" size={20} />
      </span>
      <div>
        <h1>Máy chủ đang khởi động, vui lòng chờ…</h1>
        <p>
          {rejoining && roomCode
            ? `Watchroom sẽ tự vào lại phòng ${roomCode} ngay khi kết nối xong.`
            : "Gói miễn phí có thể cần khoảng một phút để sẵn sàng."}
        </p>
      </div>
    </main>
  );
}
