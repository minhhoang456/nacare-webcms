import ono from "@jsdevtools/ono";
import redis from "../utils/redis";
import productTypeService from "./productType.service";

export const cartService = {
    getKey: (customerId: string) => `cart:${customerId}`,

    getAllCart: async (customerId: string) => {
        const cartData = await redis.hgetall(cartService.getKey(customerId));
        return Object.entries(cartData).map(([storeId, value]) => ({
            storeId,
            cart: JSON.parse(value),
        }));
    },

    deleteAllCart: async (customerId: string) => {
        await redis.del(cartService.getKey(customerId));
    },

    deleteCart: async (customerId: string, infoDelete: any) => {
        const { storeId, itemId, productTypeId } = infoDelete;
        const key = cartService.getKey(customerId);
        const cart = await redis.hget(key, `${storeId}`);
        if (cart) {
            const cartItems = JSON.parse(cart);
            const index = cartItems.findIndex((item: any) => item.itemId === itemId && item.productTypeId === productTypeId);
            if (index !== -1) {
                cartItems.splice(index, 1);
            }
            await redis.hdel(key, `${storeId}`);
        }
    },

    checkCartExistByCustomer: async (customerId: string, storeId: any) => {
        const key = cartService.getKey(customerId);
        const cart = await redis.hget(key, `${storeId}`);
        if (!cart) throw ono('e_not_found_cart');
        return JSON.parse(cart);
    },

    getCartByStoreId: async (customerId: string, storeId: any) => {
        const key = cartService.getKey(customerId);
        const cart = await redis.hget(key, `${storeId}`);
        return JSON.parse(cart as string);
    },

    getCartCommon: async (customerId: string) => {
        const cart: any = await redis.hgetall(`cart:${customerId}`)
        if (!cart) return [];

        const cartItem = Object.entries(cart).map(([storeId, value]) => ({
            storeId,
            cart: JSON.parse(value as string),
        }));

        const data = cartItem.flatMap((item: any) => item.cart);
        return data
    },

    saveCartRedis: async (customerId: string, storeId: any, cart: any) => {
        const key = cartService.getKey(customerId);
        await redis.hset(key, `${storeId}`, JSON.stringify(cart));
    },

    validateProductType: async (productTypeId: any, params: any) => {
        const { itemId, storeId } = params;
        const productType = await productTypeService.getFullProductTypeInfo(productTypeId);
        const { productTypeInfo, productInfos } = productType;
        if (!productType) throw ono("e_product_type_not_found");
        if (productTypeInfo.storeId !== storeId) throw ono("e_store_not_found");
        const checkProductInfo = productInfos.find((item: any) => item.id === itemId);
        if (!checkProductInfo) throw ono("e_product_not_found");
        return productType;
    },

    prepareProductData: (productDetails: any, cartItem: any, storeDetails: any, attributeValues: any) => {
        const { id, name, price, originPrice, payment, paymentCash, images } = productDetails;
        const preparedData = {
            ...cartItem,
            storeName: storeDetails?.name,
            productTypeId: id,
            productTypeName: name,
            productTypePrice: price,
            productTypeOriginPrice: originPrice,
            productTypePayment: payment,
            productTypePaymentCash: paymentCash,
            productTypeImages: images,
            attributeValues: attributeValues
        }
        return preparedData;
    },
};
export default cartService;
