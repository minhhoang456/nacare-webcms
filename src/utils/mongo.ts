import { MongoClient } from "mongodb";
import Config from "../config/config";

const url = Config.MONGO_DB_URL;
const client = new MongoClient(url);

export async function connectMongoDB() {
  try {
    await client.connect();
    console.log("MongoDB ===> Ok!");
  } catch (error) {
    console.log("Connect to MongoDB failed", error);
  }
}

export default client;
