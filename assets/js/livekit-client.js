import { auth } from "./firebase-config.js";
import { Room, RoomEvent } from "https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/+esm";

const TOKEN_ENDPOINT = "https://equallearn-live-token.jommelhallig655.workers.dev/token";

export async function requestLiveToken(roomId) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Please sign in to EqualLearn first.");
  const idToken = await currentUser.getIdToken();
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ roomId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || "Unable to join classroom.");
  return data;
}

export async function joinEqualLearnRoom(roomId, { onParticipantChanged, onDisconnected } = {}) {
  const access = await requestLiveToken(roomId);
  const room = new Room({ adaptiveStream: true, dynacast: true });
  room.on(RoomEvent.ParticipantConnected, onParticipantChanged || (() => {}));
  room.on(RoomEvent.ParticipantDisconnected, onParticipantChanged || (() => {}));
  room.on(RoomEvent.Disconnected, onDisconnected || (() => {}));
  await room.connect(access.serverUrl, access.token);
  return { room, access };
}

export async function leaveEqualLearnRoom(room) {
  if (room) await room.disconnect();
}
