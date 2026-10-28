import { ObjectId } from "mongodb";

export interface IMessage {
  _id?: ObjectId;
  conversationId?: string;
  senderId: number;
  senderType: SENDER_TYPE;
  recipientId: number;
  content?: string;
  messageType: MESSAGE_TYPE;
  timestamp: number;
  status?: MESSAGE_STATUS;
  attachments?: Array<string>;
  orderInfo?: IOrder;
  productInfo?: IProduct;
}

export enum SENDER_TYPE {
  USER = "USER",
  SELLER = "SELLER",
}

export interface IOrder {
  orderId: number;
  image: string;
  price: number;
  orderStatus: ORDER_STATUS;
  orderItemInfos?: Array<IOrderItemInfo>;
}

export interface IOrderItemInfo {
  typeId: number;
  quantity: number;
  images: Array<string>;
  storeId: number;
  name: string;
  totalPrice: number;
  itemPrice: number;
  salePrice: number;
  attributeValues: string;
  discount: number;
  flashSaleProductId: number;
  totalWeight: number;
}

export interface IProduct {
  productTypeId: number;
  name: string;
  image: string;
  price: number;
  originalPrice: number;
}

export enum MESSAGE_TYPE {
  TEXT = "TEXT",
  IMAGE = "IMAGE",
  FILE = "FILE",
  ORDER = "ORDER",
  PRODUCT = "PRODUCT",
}

export enum MESSAGE_STATUS {
  SENT = "SENT",
  DELIVERED = "DELIVERED",
  READ = "READ",
}

export interface IConversation {
  _id?: ObjectId;
  userId: number;
  sellerId: number;
  userInfo?: IUser;
  sellerInfo?: IStore;
  lastMessage?: IMessage;
  createdAt: number;
  updatedAt: number;
  status: CONVERSATION_STATUS;
}

export enum ORDER_STATUS {
  pending = "pending",
  processing = "processing",
  wait_for_confirmation = "wait_for_confirmation",
  wait_for_pickup = "wait_for_pickup",
  confirmed = "confirmed",
  cancelled = "cancelled",
  shipping = "shipping",
  completed = "completed",
  refunded = "refunded",
  refund = "refund",
}

export interface IUser {
  id: number;
  name: string;
  avatar: string;
}

export interface IStore {
  id: number;
  name: string;
  avatar: string;
}

export enum CONVERSATION_STATUS {
  ACTIVE = "ACTIVE",
  ARCHIVED = "ARCHIVED",
  BLOCKED = "BLOCKED",
}

export enum SOCKET_EVENTS {
  CONNECT = "connect",
  DISCONNECT = "disconnect",
  ERROR = "error",
  JOIN_ROOM = "join_room",
  LEAVE_ROOM = "leave_room",
  NEW_MESSAGE = "new_message",
  NEW_CONVERSATION_MESSAGE = "new_conversation_message",
  MESSAGE_DELIVERED = "message_delivered",
  MESSAGE_READ = "message_read",
  TYPING_START = "typing_start",
  TYPING_END = "typing_end",
  PRESENCE_UPDATE = "presence_update",
  UPDATE_STATUS = "update_status",
  FOCUS = "focus",
  BLUR = "blur",
}

export interface ITypingStatus {
  conversationId: string;
  userId: number;
  userType: SENDER_TYPE;
}
