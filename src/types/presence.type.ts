import { SENDER_TYPE } from "./chat.type";

export enum UserPresenceStatus {
  ONLINE = 'online',
  AWAY = 'away',
  OFFLINE = 'offline'
}

export interface UserPresence {
  userId: number;
  userType: SENDER_TYPE;
  status: UserPresenceStatus;
  lastActive: number;
  deviceCount: number;
} 