import ono from "@jsdevtools/ono";
import { productTypeService, storeService } from "../services";
import commonUtil from "@src/utils/common";
import redis from "../utils/redis";
import Config from "../config/config";
import elasticsearchUtil from "../utils/elasticsearch";
import { ProductTypeElasticsearch } from "../types/product.type";

const addressRegexString =
  "^[A-Za-zÀ-ỹ0-9\\s\\-\\.\\/]+,\\s*[A-Za-zÀ-ỹ\\s\\-\\.\\/]+,\\s*[A-Za-zÀ-ỹ\\s\\-\\.\\/]+,\\s*[A-Za-zÀ-ỹ\\s\\-\\.\\/]+(?:\\s*,\\s*Việt Nam)?$";
const genericAddressRegex = new RegExp(addressRegexString, "u");

function cleanAddress(address: string) {
  return address
    .replace(/,\s*\d{5,6}(,\s*Việt Nam)?$/g, "")
    .replace(/,\s*Việt Nam$/g, "")
    .replace(/,\s*$/g, "")
    .trim();
}

function validateAddress(address: string) {
  if (genericAddressRegex.test(address)) {
    return cleanAddress(address);
  }
  return null;
}

const productHelper = {
  checkQuantity: (listOrderItem: any[]) => {
    listOrderItem.forEach((e) => {
      if (e.quantity <= 0 || !Number.isInteger(e.quantity)) {
        throw ono("e_quantity_not_match");
      }
    });
    return;
  },
  checkSamePartner: (listOrderItem: any[]) => {
    const partnerIds = listOrderItem.map((e) => e.partnerId);
    const uniquePartnerIds = [...new Set(partnerIds)];
    if (uniquePartnerIds.length > 1) {
      throw ono("e_partner_not_match");
    }
    return;
  },
  getFullAddress: async (params: {
    shipServiceId: string;
    path: any[];
    storeId?: number;
  }) => {
    const { shipServiceId, path, storeId } = params;
    let storeInfo = null;
    if (storeId) {
      storeInfo = await storeService.getStoreInfoById(storeId);
    }
    const pathInfos: any[] = [];
    for (let i = 0; i < path.length; i++) {
      const e = path[i];
      const [provinceName, districtName, wardName] = await Promise.all([
        redis.get(`province:${e.provinceId}`),
        redis.get(`district:${e.districtId}`),
        redis.get(`ward:${e.wardId}`),
      ]);
      const pathInfo = {
        ...e,
        address: i > 0 ? validateAddress(e.address) : e.address,
        provinceName,
        districtName,
        wardName,
      };
      pathInfos.push(pathInfo);
    }
    const invalidAddress = pathInfos.some(
      (info) =>
        !info.provinceName ||
        !info.wardName ||
        !info.address
    );
    if (invalidAddress) throw ono("e_address_user_not_match");
    return { shipServiceId, storeInfo, pathInfos };
  },
  getListProductType: async (params: { query: any }) => {
    const {
      skip,
      limit,
      categoryId,
      isHot,
      storeId,
      keyword,
      ids,
      sort,
      typeSort,
    } = params.query;
    const repositoryRedisOMProduct = productTypeService.getRepositoryRedisOm();
    const sortQuery: any = {
      sort: "DESC",
      field: "id",
    };
    let listQuery = repositoryRedisOMProduct.search();
    let countQuery = repositoryRedisOMProduct.search();
    if (categoryId) {
      listQuery = listQuery
        .and("categoryId")
        .eq(categoryId)
        .or("subCategoryId")
        .eq(categoryId);
      countQuery = countQuery
        .and("categoryId")
        .eq(categoryId)
        .or("subCategoryId")
        .eq(categoryId);
    }
    if (storeId) {
      listQuery = listQuery.and("storeId").eq(storeId);
      countQuery = countQuery.and("storeId").eq(storeId);
    }
    if (isHot) {
      sortQuery.sort = "DESC";
      sortQuery.field = "hotSequence";
      listQuery = listQuery.and("hotSequence").greaterThan(0);
      countQuery = countQuery.and("hotSequence").greaterThan(0);
    }
    if (ids && ids.length > 0) {
      listQuery = listQuery
        .and("ids")
        .containOneOf(...ids.map((id: any) => id.toString()));
      countQuery = countQuery
        .and("ids")
        .containOneOf(...ids.map((id: any) => id.toString()));
    }
    if (keyword) {
      const keywordRemoveAccent = `*${commonUtil.removeAccentsAndReplaceSpaces(
        keyword,
        "lowercase"
      )}*`;
      listQuery = listQuery.and((search) =>
        search
          .where("name")
          .matches(keywordRemoveAccent)
          .or("categoryName")
          .matches(keywordRemoveAccent)
          .or("categoryNameEn")
          .matches(keywordRemoveAccent)
          .or("subCategoryName")
          .matches(keywordRemoveAccent)
          .or("storeName")
          .matches(keywordRemoveAccent)
          .or("tags")
          .containOneOf(keywordRemoveAccent)
          .or("translations")
          .containOneOf(keywordRemoveAccent)
      );
      countQuery = countQuery.and((search) =>
        search
          .where("name")
          .matches(keywordRemoveAccent)
          .or("categoryName")
          .matches(keywordRemoveAccent)
          .or("categoryNameEn")
          .matches(keywordRemoveAccent)
          .or("subCategoryName")
          .matches(keywordRemoveAccent)
          .or("storeName")
          .matches(keywordRemoveAccent)
          .or("tags")
          .containOneOf(keywordRemoveAccent)
          .or("translations")
          .containOneOf(keywordRemoveAccent)
      );
    }
    if (sort) {
      switch (sort) {
        case "sell": {
          sortQuery.field = "purchased";
          if (typeSort) {
            sortQuery.sort = typeSort;
          } else {
            sortQuery.sort = "DESC";
          }
          break;
        }
        case "price": {
          sortQuery.field = "paymentCash";
          if (typeSort) {
            sortQuery.sort = typeSort;
          } else {
            sortQuery.sort = "ASC";
          }
          break;
        }
        case "random": {
          sortQuery.field = "randomNumber";
          sortQuery.sort = "ASC";
          break;
        }
      }
    }
    const results = await Promise.all([
      listQuery.return
        .sortBy(sortQuery.field, sortQuery.sort)
        .page(skip, limit),
      countQuery.return.count(),
    ]);
    if (results[0].length > 0) {
      const listProduct = results[0].map((e: any) => {
        try {
          const voucherInfo = JSON.parse(e.fullProductTypeInfoRef as any);
          return voucherInfo;
        } catch (error) {
          return e;
        }
      });
      return {
        data: listProduct,
        total: results[1],
      };
    } else {
      return {
        data: [],
        total: 0,
      };
    }
  },

  getKeyIndexProductTypeInElasticsearch: () => {
    return `${Config.ELASTICSEARCH_CONFIG.prefix}_product_type_index`;
  },

  createIndexProductInElasticsearch: async () => {
    const indexName = productHelper.getKeyIndexProductTypeInElasticsearch();
    try {
      // Check if index exists
      const indexExists =
        await elasticsearchUtil.elasticsearchClient.indices.exists({
          index: indexName,
        });

      if (indexExists) {
        console.log("Index product type already exists");

        // Option 1: Update existing index mapping (if needed)
        try {
          await elasticsearchUtil.elasticsearchClient.indices.putMapping({
            index: indexName,
            body: {
              properties: {
                id: { type: "integer" },
                name: {
                  type: "text",
                  analyzer: "my_vi_analyzer",
                  search_analyzer: "my_vi_analyzer",
                },
                categoryName: {
                  type: "text",
                  analyzer: "my_vi_analyzer",
                  search_analyzer: "my_vi_analyzer",
                },
                categoryNameEn: {
                  type: "text",
                  analyzer: "my_vi_analyzer",
                  search_analyzer: "my_vi_analyzer",
                },
                subCategoryName: {
                  type: "text",
                  analyzer: "my_vi_analyzer",
                  search_analyzer: "my_vi_analyzer",
                },
                storeName: {
                  type: "text",
                  analyzer: "my_vi_analyzer",
                  search_analyzer: "my_vi_analyzer",
                },
                tags: {
                  type: "keyword",
                  fields: {
                    text: {
                      type: "text",
                      analyzer: "my_vi_analyzer",
                      search_analyzer: "my_vi_analyzer",
                    },
                  },
                },
                translations: {
                  type: "keyword",
                  fields: {
                    text: {
                      type: "text",
                      analyzer: "my_vi_analyzer",
                      search_analyzer: "my_vi_analyzer",
                    },
                  },
                },
                brandName: {
                  type: "text",
                  analyzer: "my_vi_analyzer",
                  search_analyzer: "my_vi_analyzer",
                },
                categoryStoreName: {
                  type: "text",
                  analyzer: "my_vi_analyzer",
                  search_analyzer: "my_vi_analyzer",
                },
              },
            },
          });
          console.log("Index product type mapping updated successfully");
        } catch (updateError) {
          console.error("Error updating mapping:", updateError);
        }
        return;
      }

      // Create new index if it doesn't exist
      await elasticsearchUtil.elasticsearchClient.indices.create({
        index: indexName,
        body: {
          settings: {
            analysis: {
              analyzer: {
                my_vi_analyzer: {
                  // @ts-ignore
                  type: "vi_analyzer",
                  keep_punctuation: true,
                  // tokenizer: 'vi_tokenizer',
                  stopwords: ["rất", "những"],
                },
              },
            },
          },
          mappings: {
            properties: {
              id: { type: "integer" },
              name: {
                type: "text",
                analyzer: "my_vi_analyzer",
                search_analyzer: "my_vi_analyzer",
              },
              categoryName: {
                type: "text",
                analyzer: "my_vi_analyzer",
                search_analyzer: "my_vi_analyzer",
              },
              categoryNameEn: {
                type: "text",
                analyzer: "my_vi_analyzer",
                search_analyzer: "my_vi_analyzer",
              },
              subCategoryName: {
                type: "text",
                analyzer: "my_vi_analyzer",
                search_analyzer: "my_vi_analyzer",
              },
              storeName: {
                type: "text",
                analyzer: "my_vi_analyzer",
                search_analyzer: "my_vi_analyzer",
              },
              tags: {
                type: "keyword",
                fields: {
                  text: {
                    type: "text",
                    analyzer: "my_vi_analyzer",
                    search_analyzer: "my_vi_analyzer",
                  },
                },
              },
              translations: {
                type: "keyword",
                fields: {
                  text: {
                    type: "text",
                    analyzer: "my_vi_analyzer",
                    search_analyzer: "my_vi_analyzer",
                  },
                },
              },
            },
          },
        },
      });
      console.log("Index voucher info created successfully");
    } catch (error) {
      console.error("Error handling index voucher info:", error);
      throw error;
    }
  },

  indexDocumentsProductType: async (documents: ProductTypeElasticsearch[]) => {
    try {
      const indexName = productHelper.getKeyIndexProductTypeInElasticsearch();
      // Remove all key not in documents
      const allKeyInIndex = await elasticsearchUtil.elasticsearchClient.search({
        index: indexName,
        _source: ["id"],
      });
      const idsInIndex = allKeyInIndex.hits.hits.map(
        (hit: any) => hit._source.id
      );
      const idsNotInDocuments = idsInIndex.filter(
        (id: any) => !documents.some((doc) => doc.id === id)
      );
      if (idsNotInDocuments.length > 0) {
        await elasticsearchUtil.elasticsearchClient.deleteByQuery({
          index: indexName,
          body: {
            query: {
              ids: { values: idsNotInDocuments },
            },
          },
        });
      }
      const operations = documents.flatMap((doc) => [
        { index: { _index: indexName, _id: doc.id } },
        doc,
      ]);
      const result = await elasticsearchUtil.elasticsearchClient.bulk({
        refresh: true,
        operations,
      });

      if (result.errors) {
        console.error("Errors during bulk indexing");
        return false;
      }
      console.log("Documents indexed successfully");
      return true;
    } catch (error) {
      console.error("Error indexing documents:", error);
      return false;
    }
  },

  searchProductTypeByKeyword: async ({
    searchText,
    skip,
    limit,
  }: {
    searchText: string;
    skip: number;
    limit: number;
  }): Promise<{ ids: number[]; total: number }> => {
    try {
      const indexName = productHelper.getKeyIndexProductTypeInElasticsearch();
      const result = await elasticsearchUtil.elasticsearchClient.search({
        index: indexName,
        body: {
          from: skip,
          size: limit,
          query: {
            bool: {
              should: [
                {
                  multi_match: {
                    query: searchText,
                    fields: [
                      "name^2",
                      "categoryName",
                      "categoryNameEn",
                      "subCategoryName",
                      "storeName",
                      "brandName",
                      "categoryStoreName",
                    ],
                    type: "best_fields",
                    operator: "or",
                    fuzziness: "AUTO",
                  },
                },
                {
                  match: {
                    "tags.text": {
                      query: searchText,
                      operator: "or",
                    },
                  },
                },
                {
                  match: {
                    "translations.text": {
                      query: searchText,
                      operator: "or",
                    },
                  },
                },
              ],
            },
          },
        },
      });

      // Extract ids from response
      const ids = result.hits.hits.map((hit: any) => hit._source.id);
      return {
        ids,
        // @ts-ignore
        total: result.hits.total.value || 0,
      };
    } catch (error) {
      console.error("Error searching:", error);
      return {
        ids: [],
        total: 0,
      };
    }
  },
};
export default productHelper;
