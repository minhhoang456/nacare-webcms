import { Client } from "@elastic/elasticsearch";
import Config from "@src/config/config";

const elasticsearchClient = new Client({
  node: Config.ELASTICSEARCH_CONFIG.node,
  auth: {
    username: Config.ELASTICSEARCH_CONFIG.username,
    password: Config.ELASTICSEARCH_CONFIG.password,
  },
});

// Create function try connect to elasticsearch
const tryConnectToElasticsearch = async () => {
  try {
    await elasticsearchClient.ping();
    console.log("Elasticsearch ===> Ok!");
  } catch (error) {
    console.error("Error connecting to Elasticsearch:", error);
  }
};

export default {
  elasticsearchClient,
  tryConnectToElasticsearch,
};
