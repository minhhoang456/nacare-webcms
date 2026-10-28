-- CreateEnum
CREATE TYPE "StatusFileUpload" AS ENUM ('finished', 'fail');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('voucher', 'product', 'megamall');

-- CreateEnum
CREATE TYPE "ProductPaymentEnum" AS ENUM ('free', 'point', 'cash', 'both');

-- CreateEnum
CREATE TYPE "CustomerGender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "VoucherPaymentEnum" AS ENUM ('free', 'point', 'online', 'both');

-- CreateEnum
CREATE TYPE "VoucherCodeTypeEnum" AS ENUM ('random', 'import', 'api', 'exchange');

-- CreateEnum
CREATE TYPE "VoucherTypeEnum" AS ENUM ('earn_on_ecom', 'earn_on_voucher', 'earn_off', 'exchange_discount_percent', 'exchange_gift_another', 'exchange_discount_cash', 'exchange_product', 'gift', 'stamp', 'ticket');

-- CreateEnum
CREATE TYPE "VoucherActionEnum" AS ENUM ('show_code', 'show_web', 'show_app');

-- CreateEnum
CREATE TYPE "VoucherTypeVoucherEnum" AS ENUM ('partner', 'store', 'products_my_app', 'full_product_my_app', 'store_my_app');

-- CreateEnum
CREATE TYPE "ProductTypePaymentEnum" AS ENUM ('free', 'point', 'cash', 'both');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('product', 'voucher', 'flashsale');

-- CreateEnum
CREATE TYPE "OrderItemType" AS ENUM ('product', 'voucher');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('pending', 'processing', 'paid', 'wait_for_confirmation', 'wait_for_pickup', 'shipping', 'completed', 'canceled');

-- CreateEnum
CREATE TYPE "AttributeDisplayTypeEnum" AS ENUM ('text', 'productImage');

-- CreateEnum
CREATE TYPE "OrderPaymentStatusEnum" AS ENUM ('pending', 'processing', 'wait_for_confirmation', 'comfirmed', 'shipping', 'completed', 'canceled', 'refund', 'refunded');

-- CreateEnum
CREATE TYPE "OrderMethodPaymentEnum" AS ENUM ('cod', 'online');

-- CreateEnum
CREATE TYPE "statusCodeRequest" AS ENUM ('pending', 'finished');

-- CreateEnum
CREATE TYPE "codeTypeCodeRequest" AS ENUM ('random', 'import');

-- CreateEnum
CREATE TYPE "onlyUsedCodeRequest" AS ENUM ('all', 'store', 'products');

-- CreateEnum
CREATE TYPE "typeCodeRequest" AS ENUM ('voucher', 'discount', 'point', 'gamecode', 'both', 'product');

-- CreateEnum
CREATE TYPE "typeEnumFlashsale" AS ENUM ('voucher', 'product');

-- CreateEnum
CREATE TYPE "PaymentProcessTimeoutStatusEnum" AS ENUM ('none', 'processing', 'done');

-- CreateEnum
CREATE TYPE "PaymentMethodEnum" AS ENUM ('cash', 'point', 'online', 'both');

-- CreateEnum
CREATE TYPE "PaymentStatusEnum" AS ENUM ('processing', 'success', 'failed', 'unfinish', 'error', 'scam', 'refund', 'refunded', 'refund_err', 'cheat');

-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('FLASHSALE', 'DEALHOT', 'MONOPOLY', 'FREE');

-- CreateEnum
CREATE TYPE "DatasetType" AS ENUM ('BLACK_LIST', 'WHITE_LIST');

-- CreateEnum
CREATE TYPE "StatusOfParent" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "onlyUsedType" AS ENUM ('all', 'store', 'voucher');

-- CreateTable
CREATE TABLE "actionlog" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "model" VARCHAR(255),
    "action" VARCHAR(255),
    "data" JSONB,
    "userId" INTEGER,
    "role" INTEGER,
    "ip" VARCHAR(255),
    "ip2" VARCHAR(255),

    CONSTRAINT "actionlog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conf" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "val" VARCHAR(255),
    "type" VARCHAR(255),
    "description" VARCHAR(255),

    CONSTRAINT "conf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fileupload" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "fileName" VARCHAR(255),
    "fileType" VARCHAR(255),
    "status" "StatusFileUpload",
    "fullUrl" VARCHAR(255),
    "url" VARCHAR(255),
    "serverFileName" VARCHAR(255),
    "serverFileDir" VARCHAR(255),
    "user" INTEGER,
    "server1" BOOLEAN DEFAULT false,
    "server2" BOOLEAN DEFAULT false,

    CONSTRAINT "fileupload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "url" VARCHAR(255),
    "icon" JSONB DEFAULT '{}',
    "roles" JSONB,
    "parent" INTEGER,
    "isParent" BOOLEAN,
    "sequence" INTEGER,
    "isActive" BOOLEAN,

    CONSTRAINT "menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outgoing" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "host" TEXT,
    "req" TEXT,
    "res" TEXT,
    "dur" DOUBLE PRECISION,
    "api" VARCHAR(255),
    "error" DOUBLE PRECISION,

    CONSTRAINT "outgoing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "desc" VARCHAR(255),
    "form" JSONB,
    "schema" JSONB,
    "buttons" JSONB,
    "type" VARCHAR(255),
    "read" VARCHAR(255),
    "submit" VARCHAR(255),
    "roles" JSONB,
    "apis" JSONB,
    "procedures" JSONB,
    "grid" JSONB,
    "settings" JSONB,

    CONSTRAINT "page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requestlog" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "api" VARCHAR(255),
    "merchantId" INTEGER,
    "request" TEXT,
    "response" TEXT,
    "code" INTEGER,
    "header" TEXT,
    "dur" INTEGER,
    "ip" VARCHAR(255),

    CONSTRAINT "requestlog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setting" (
    "name" VARCHAR(255),
    "settings" JSONB DEFAULT '{}',
    "id" SERIAL NOT NULL,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "phone" VARCHAR(255),
    "email" VARCHAR(255),
    "birth" BIGINT,
    "roleId" INTEGER,
    "gender" INTEGER,
    "address" VARCHAR(255),
    "username" VARCHAR(255),
    "password" VARCHAR(255),
    "avatar" VARCHAR(255),
    "sourceId" INTEGER,
    "partnerIds" JSONB DEFAULT '[]',
    "storeId" INTEGER,
    "changePasswordAt" INTEGER,
    "gameProviderId" INTEGER,
    "taxCode" VARCHAR(255),
    "cmnd" VARCHAR(255),
    "dateSupplyCmnd" INTEGER,
    "addressSupplyTaxCode" VARCHAR(255),
    "merchantId" INTEGER,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "hotSequence" INTEGER,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "parentId" INTEGER DEFAULT 0,
    "isActive" BOOLEAN DEFAULT true,
    "image" VARCHAR(255),
    "type" "CategoryType",
    "isHot" BOOLEAN DEFAULT false,
    "mexchangeCategoryId" TEXT,
    "sequence" INTEGER,
    "megamallSequence" INTEGER,
    "merchantIds" JSONB DEFAULT '[]',
    "rulePointType" TEXT DEFAULT 'both',
    "haveVoucherDefault" BOOLEAN DEFAULT false,
    "voucherId" INTEGER,
    "isFixedPosition" BOOLEAN DEFAULT true,
    "typePosition" TEXT,
    "percentEarnPoint" INTEGER DEFAULT 0,
    "linkAccess" TEXT,
    "color" VARCHAR(255),
    "label" VARCHAR(255),

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_map_exchange" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "keyMap" TEXT,
    "categoryId" INTEGER,

    CONSTRAINT "category_map_exchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "height" DOUBLE PRECISION,
    "lengths" DOUBLE PRECISION,
    "widths" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "paymentCash" INTEGER DEFAULT 0,
    "paymentPoint" INTEGER DEFAULT 0,
    "payment" "ProductPaymentEnum",
    "originPrice" INTEGER,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "itemId" DOUBLE PRECISION,
    "productTypeId" DOUBLE PRECISION,
    "name" VARCHAR(255),
    "isActive" BOOLEAN DEFAULT true,
    "description" TEXT,
    "images" JSONB,
    "isDelete" BOOLEAN DEFAULT false,
    "storeId" INTEGER,
    "tags" TEXT,
    "mexchangeId" TEXT,
    "mexchangeProductTypeId" TEXT,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slogan" TEXT,
    "logo" TEXT,
    "detail" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "alt" TEXT DEFAULT '',
    "order" INTEGER,
    "sourceId" INTEGER,
    "partnerId" TEXT,
    "isActive" BOOLEAN DEFAULT true,
    "hotSequence" INTEGER DEFAULT 0,
    "billPointPercent" DOUBLE PRECISION DEFAULT 0,
    "rulePointType" TEXT,
    "haveVoucherDefault" BOOLEAN DEFAULT false,
    "voucherId" INTEGER,
    "categoryName" TEXT,
    "coverImage" TEXT,
    "sourceName" TEXT,
    "images" JSONB DEFAULT '[]',
    "providerId" INTEGER,
    "isMonopoly" BOOLEAN DEFAULT false,

    CONSTRAINT "partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "tierId" INTEGER DEFAULT 1,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "phone" VARCHAR(255),
    "facebookId" VARCHAR(255),
    "googleId" VARCHAR(255),
    "email" VARCHAR(255),
    "birth" BIGINT,
    "gender" "CustomerGender" DEFAULT 'male',
    "address" VARCHAR(255),
    "avatar" VARCHAR(255),
    "contact" VARCHAR(255),
    "exchangeId" VARCHAR(255),
    "provinceId" INTEGER,
    "districtId" INTEGER,
    "wardId" INTEGER,
    "inviteCode" VARCHAR(255),
    "secure" VARCHAR(255),
    "countNotiUnRead" INTEGER DEFAULT 0,
    "merchantId" INTEGER,
    "merchantRef" VARCHAR(255),
    "mpoint" INTEGER,
    "totalMpoint" INTEGER,
    "codeCount" INTEGER DEFAULT 0,
    "isBlock" BOOLEAN DEFAULT false,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER,
    "customerId" INTEGER,
    "voucherId" INTEGER NOT NULL,
    "voucherGiftId" INTEGER,
    "voucherName" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "logoPartner" TEXT,
    "thumb" TEXT,
    "imagesVoucher" JSONB DEFAULT '[]',
    "partnerId" INTEGER,
    "shopId" INTEGER,
    "lockState" BOOLEAN NOT NULL DEFAULT false,
    "used" BOOLEAN NOT NULL,
    "usedAt" BIGINT,
    "code" TEXT,
    "isExpired" BOOLEAN NOT NULL DEFAULT false,
    "expiredAt" BIGINT,
    "timeToLive" BIGINT,
    "price" DOUBLE PRECISION NOT NULL,
    "sourceId" INTEGER,
    "refId" INTEGER,
    "percent" DOUBLE PRECISION,
    "value" TEXT,
    "phone" TEXT,
    "createMethod" TEXT,
    "action" TEXT NOT NULL DEFAULT 'show_code',
    "tierId" INTEGER,
    "productIdsOfVoucher" JSONB DEFAULT '[]',
    "typeVoucher" TEXT DEFAULT 'store',
    "storeMyAppId" INTEGER,
    "urlTemplate" TEXT,
    "linkPartner" TEXT,
    "status" TEXT DEFAULT 'got',
    "codeIdMexchange" TEXT,
    "cardSerial" TEXT,
    "orderItemId" INTEGER,
    "stampNumber" INTEGER,
    "stampCount" INTEGER,
    "codeType" "VoucherCodeTypeEnum",
    "displayCodeType" VARCHAR(20),
    "serviceCode" TEXT,
    "serviceCodeType" TEXT,

    CONSTRAINT "code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "importcode" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "voucherId" INTEGER,
    "used" BOOLEAN,
    "code" VARCHAR(255),
    "usedAt" BIGINT,
    "usedBy" BIGINT,
    "codeRequestId" INTEGER,
    "fileId" INTEGER,

    CONSTRAINT "importcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "startDate" INTEGER NOT NULL,
    "endDate" INTEGER NOT NULL,
    "active" BOOLEAN DEFAULT true,
    "createdBy" INTEGER NOT NULL,
    "itemId" INTEGER,
    "thumbnail" TEXT,
    "isShow" BOOLEAN DEFAULT true,
    "countdown" BOOLEAN DEFAULT true,
    "type" TEXT,
    "sequence" INTEGER,
    "clientIds" JSONB DEFAULT '[]',
    "gender" TEXT,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher" (
    "accessLink" VARCHAR(255),
    "discountCash" INTEGER,
    "type" "VoucherTypeEnum",
    "giftPoint" INTEGER,
    "discountPercent" INTEGER,
    "billPointPercent" REAL,
    "hotSequence" INTEGER DEFAULT 0,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "groupId" INTEGER,
    "itemId" DOUBLE PRECISION,
    "providerId" INTEGER,
    "partnerId" DOUBLE PRECISION NOT NULL,
    "shops" JSONB DEFAULT '[]',
    "name" VARCHAR(255),
    "images" JSONB DEFAULT '[]',
    "description" TEXT,
    "instructionManual" TEXT,
    "price" DOUBLE PRECISION DEFAULT 0,
    "limiter" DOUBLE PRECISION,
    "isBanner" BOOLEAN,
    "value" VARCHAR(255),
    "payment" "VoucherPaymentEnum",
    "paymentPoint" DOUBLE PRECISION DEFAULT 0,
    "paymentCash" DOUBLE PRECISION DEFAULT 0,
    "startDate" BIGINT,
    "endDate" BIGINT,
    "startTime" BIGINT,
    "endTime" BIGINT,
    "weekdays" JSONB DEFAULT '[]',
    "daysOfMonth" JSONB DEFAULT '[]',
    "categoryId" DOUBLE PRECISION,
    "subCategoryId" DOUBLE PRECISION,
    "codeType" "VoucherCodeTypeEnum",
    "codeTimeType" VARCHAR(50),
    "displayCodeType" VARCHAR(20),
    "codeTime" BIGINT,
    "isActive" BOOLEAN DEFAULT false,
    "tags" JSONB DEFAULT '[]',
    "isApprove" BOOLEAN DEFAULT false,
    "applyOnlyForMemberPartner" BOOLEAN DEFAULT false,
    "creatorId" INTEGER,
    "sourceId" VARCHAR(100),
    "thumb" VARCHAR(255),
    "provider" VARCHAR(255),
    "voucherId" VARCHAR(100),
    "area" VARCHAR(255),
    "itemGroupId" INTEGER,
    "campaignId" INTEGER DEFAULT 0,
    "action" "VoucherActionEnum" DEFAULT 'show_code',
    "urlTemplate" VARCHAR(1000),
    "turnGame" INTEGER DEFAULT 0,
    "flagIds" JSONB DEFAULT '[]',
    "percentDiscountForVietTel" DOUBLE PRECISION,
    "amountCodeCreated" INTEGER DEFAULT 0,
    "isHot" BOOLEAN,
    "productIdsOfVoucher" JSONB DEFAULT '[]',
    "typeVoucher" "VoucherTypeVoucherEnum" DEFAULT 'store',
    "storeMyAppId" INTEGER DEFAULT 0,
    "countdown" BOOLEAN,
    "linkPartner" VARCHAR(255),
    "tagsId" JSONB DEFAULT '[]',
    "tagsStr" TEXT,
    "note" VARCHAR(255),
    "giftType" VARCHAR(255),
    "giftVoucherId" INTEGER,
    "stampCount" INTEGER,
    "sequence" INTEGER,
    "isMonopoly" BOOLEAN DEFAULT false,
    "serviceCodeType" INTEGER,
    "serviceCode" TEXT,
    "serviceCodeBackground" TEXT,
    "serviceCodeIcon" TEXT,
    "serviceCodeTag" TEXT,
    "label" VARCHAR(255),
    "voucherTypeDiscount" INTEGER,
    "valueDiscount" DOUBLE PRECISION,
    "valuePercentDiscount" DOUBLE PRECISION,
    "valueMaxDiscount" DOUBLE PRECISION,
    "minAmountPayment" DOUBLE PRECISION,
    "isYourSelf" BOOLEAN DEFAULT false,

    CONSTRAINT "voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producttype" (
    "discountRate" DOUBLE PRECISION DEFAULT 0,
    "weight" DOUBLE PRECISION,
    "subCategoryId" INTEGER,
    "percentAccumlatePoints" DOUBLE PRECISION DEFAULT 0,
    "isApprove" BOOLEAN DEFAULT false,
    "flagIds" JSONB DEFAULT '[]',
    "tags" VARCHAR(255),
    "paymentCash" INTEGER DEFAULT 0,
    "paymentPoint" INTEGER DEFAULT 0,
    "payment" "ProductTypePaymentEnum",
    "storeId" INTEGER,
    "location" VARCHAR(255),
    "guarantee" VARCHAR(255),
    "trademark" VARCHAR(255),
    "hotSequence" INTEGER,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "itemId" DOUBLE PRECISION,
    "shopId" DOUBLE PRECISION,
    "categoryId" DOUBLE PRECISION,
    "name" VARCHAR(255),
    "description" TEXT,
    "images" JSONB,
    "isActive" BOOLEAN,
    "thumbnail" VARCHAR(255),
    "originPrice" DOUBLE PRECISION,
    "campaignId" INTEGER DEFAULT 0,
    "valueAccumulatePoints" DOUBLE PRECISION DEFAULT 0,
    "startDate" BIGINT,
    "endDate" BIGINT,
    "isHot" BOOLEAN,
    "type" VARCHAR(255),
    "note" VARCHAR(255),
    "accumlatePointType" VARCHAR(255) DEFAULT 'value',
    "productTypeIdRef" INTEGER,
    "mexchangeId" TEXT,
    "mexchangeType" TEXT,
    "origin" TEXT,
    "instruction" TEXT,
    "suggestion" JSONB DEFAULT '[]',
    "shortDescription" TEXT,

    CONSTRAINT "producttype_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "countRate" INTEGER DEFAULT 0,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "totalLike" DOUBLE PRECISION DEFAULT 0,
    "avgRate" DOUBLE PRECISION DEFAULT 0,
    "totalStar" DOUBLE PRECISION DEFAULT 0,
    "oneStar" DOUBLE PRECISION DEFAULT 0,
    "twoStar" DOUBLE PRECISION DEFAULT 0,
    "threeStar" DOUBLE PRECISION DEFAULT 0,
    "fourStar" DOUBLE PRECISION DEFAULT 0,
    "fiveStar" DOUBLE PRECISION DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "purchased" INTEGER NOT NULL DEFAULT 0,
    "itemGroupId" INTEGER DEFAULT 0,
    "useQuantity" BOOLEAN DEFAULT false,
    "totalComment" INTEGER DEFAULT 0,
    "viewVoucher" INTEGER DEFAULT 0,
    "type" "ItemType",
    "typeId" INTEGER,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orderitem" (
    "note" VARCHAR(255),
    "amountAccumulatePoints" INTEGER DEFAULT 0,
    "itemPrice" INTEGER DEFAULT 0,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "orderId" DOUBLE PRECISION,
    "customerId" DOUBLE PRECISION,
    "type" "OrderItemType",
    "typeId" DOUBLE PRECISION,
    "itemId" DOUBLE PRECISION,
    "groupItemId" DOUBLE PRECISION,
    "images" JSONB,
    "name" VARCHAR(255),
    "quantity" DOUBLE PRECISION,
    "totalPrice" DOUBLE PRECISION DEFAULT 0,
    "shippPrice" DOUBLE PRECISION DEFAULT 0,
    "status" "OrderItemStatus",
    "cancelReason" VARCHAR(255),
    "point" DOUBLE PRECISION,
    "cash" DOUBLE PRECISION,
    "storeId" DOUBLE PRECISION,
    "productTypeId" INTEGER,
    "typeItem" VARCHAR(255),
    "categoryName" VARCHAR(255),
    "categoryId" INTEGER,
    "discount" DOUBLE PRECISION,
    "orderShipId" INTEGER,
    "attribute" VARCHAR(255),
    "attributeValue" VARCHAR(255),
    "mexchangeId" TEXT,
    "flashSaleVoucherId" INTEGER,
    "payment" VARCHAR(255),

    CONSTRAINT "orderitem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "province" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "type" VARCHAR(255),
    "sortIndex" INTEGER,

    CONSTRAINT "province_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucherCategory" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "voucherId" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "earnPercent" DOUBLE PRECISION DEFAULT 0,

    CONSTRAINT "voucherCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "phone" VARCHAR(255),
    "address" VARCHAR(255),
    "gps" VARCHAR(255),
    "partnerId" INTEGER,
    "provinceId" INTEGER,
    "districtId" INTEGER,
    "wardId" INTEGER,
    "isActive" BOOLEAN DEFAULT true,
    "sourceId" INTEGER,
    "shopId" VARCHAR(100),
    "closeTime" VARCHAR(20),

    CONSTRAINT "shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "title" VARCHAR(255),
    "type" VARCHAR(255),
    "single" BOOLEAN DEFAULT true,
    "query" TEXT DEFAULT '[]',
    "isActive" BOOLEAN DEFAULT true,
    "orderBy" TEXT DEFAULT '[]',
    "skip" INTEGER DEFAULT 0,
    "limit" INTEGER DEFAULT 0,
    "index" INTEGER DEFAULT 0,
    "location" TEXT,
    "valueConfig" TEXT,

    CONSTRAINT "home_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "description" VARCHAR(255),
    "categoryId" INTEGER,
    "displayType" "AttributeDisplayTypeEnum",
    "mexchangeId" VARCHAR(255),

    CONSTRAINT "attribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attributevalue" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "attributeId" INTEGER,
    "name" VARCHAR(255),
    "description" VARCHAR(255),
    "productTypeId" INTEGER,

    CONSTRAINT "attributevalue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productattributevalue" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "productId" INTEGER,
    "attributeValueId" INTEGER,

    CONSTRAINT "productattributevalue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banner" (
    "position" VARCHAR(255),
    "sequence" INTEGER,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "image" VARCHAR(255),
    "isActive" BOOLEAN,
    "action" VARCHAR(255),
    "actionData" VARCHAR(255),
    "dataItem" JSONB DEFAULT '[]',
    "app" VARCHAR(255),

    CONSTRAINT "banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "limiter" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "itemId" INTEGER,
    "fromDate" INTEGER DEFAULT 0,
    "toDate" INTEGER DEFAULT 0,
    "limitProgram" INTEGER NOT NULL DEFAULT -1,
    "limitUserProgram" INTEGER NOT NULL DEFAULT -1,
    "limitDay" INTEGER DEFAULT -1,
    "limitUserDay" INTEGER DEFAULT -1,
    "limitHour" INTEGER DEFAULT -1,
    "limitUserHour" INTEGER DEFAULT -1,
    "limiterWarningId" INTEGER,
    "limiterMonth" INTEGER DEFAULT -1,
    "limiterUserMonth" INTEGER DEFAULT -1,
    "groups" JSONB DEFAULT '[]',

    CONSTRAINT "limiter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "secretKey" TEXT,
    "restrictIp" TEXT,
    "isActive" BOOLEAN DEFAULT false,
    "webhook" TEXT,
    "keyCheckSum" TEXT,
    "merchantCode" TEXT,
    "bundleId" TEXT,

    CONSTRAINT "merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store" (
    "phone" VARCHAR(255),
    "gpsLocation" VARCHAR(255),
    "address" VARCHAR(255),
    "wardId" INTEGER NOT NULL,
    "districtId" INTEGER NOT NULL,
    "provinceId" INTEGER NOT NULL,
    "totalRate" INTEGER,
    "countRate" INTEGER,
    "background" VARCHAR(255),
    "chatLink" VARCHAR(255),
    "productCount" INTEGER,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "logo" VARCHAR(255),
    "slogan" VARCHAR(255),
    "rate" DOUBLE PRECISION,
    "deliveryOntime" BIGINT,
    "shipMoney" DOUBLE PRECISION,
    "usingStoreShipMoney" BOOLEAN,
    "displayAmoutProduct" BOOLEAN,
    "serviceShip" VARCHAR(255),
    "iconServiceShip" VARCHAR(255),
    "disablePointPay" BOOLEAN,
    "email" VARCHAR(255),
    "mexchangePartnerId" TEXT,
    "mexchangeId" TEXT,

    CONSTRAINT "store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "methodPayment" "OrderMethodPaymentEnum",
    "discount" INTEGER,
    "totalAccumulatePoints" INTEGER DEFAULT 0,
    "discountCode" VARCHAR(255),
    "note" VARCHAR(255),
    "image" VARCHAR(255),
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "totalMoney" DOUBLE PRECISION,
    "customerId" DOUBLE PRECISION NOT NULL,
    "receiveName" VARCHAR(255),
    "receivePhone" VARCHAR(255),
    "receiveEmail" VARCHAR(255),
    "provinceId" INTEGER,
    "districtId" INTEGER,
    "wardId" INTEGER,
    "address" VARCHAR(255),
    "shipMoney" DOUBLE PRECISION,
    "paymentStatus" "OrderPaymentStatusEnum" DEFAULT 'pending',
    "moneyPaid" DOUBLE PRECISION,
    "pointPaid" DOUBLE PRECISION,
    "cancelReason" VARCHAR(255),
    "linkReturnUrl" VARCHAR(255),
    "transporterOrder" VARCHAR(255),
    "shipOrderCodeId" VARCHAR(255),
    "typeItem" VARCHAR(255),
    "transactionId" VARCHAR(255),
    "mexchangeOrderId" TEXT,
    "cashTransactionId" INTEGER,
    "itemCount" INTEGER,
    "codeRewardGame" TEXT,
    "orderPlace" TEXT,
    "sourceOrder" TEXT DEFAULT 'normal',
    "buyTogetherId" INTEGER,
    "merchantId" INTEGER,
    "typeOrder" TEXT DEFAULT 'customer',
    "multiSeatIds" JSONB DEFAULT '[]',
    "flashSaleVoucherId" INTEGER,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coderequest" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "creatorId" INTEGER,
    "voucherId" INTEGER,
    "description" VARCHAR(255),
    "nameCode" VARCHAR(255),
    "amount" INTEGER,
    "provider" VARCHAR(255),
    "gameCodeProviderId" INTEGER,
    "note" VARCHAR(255),
    "fileId" INTEGER,
    "status" "statusCodeRequest" NOT NULL DEFAULT 'pending',
    "type" "typeCodeRequest",
    "typeId" INTEGER,
    "codeType" "codeTypeCodeRequest",
    "typeDiscount" VARCHAR(255),
    "value" INTEGER,
    "expireCodeDiscount" INTEGER,
    "startTimeCanEnterCode" INTEGER,
    "minValueOfOrder" INTEGER,
    "maxValueOfOrder" INTEGER,
    "maxValueDiscount" INTEGER,
    "onlyUsed" "onlyUsedCodeRequest" NOT NULL DEFAULT 'all',
    "storeId" INTEGER,
    "productIds" JSONB DEFAULT '[]',
    "gameTurn" INTEGER,
    "gameId" INTEGER,

    CONSTRAINT "coderequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flashsale" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "startDate" BIGINT NOT NULL,
    "endDate" BIGINT NOT NULL,
    "isActive" BOOLEAN,
    "type" "typeEnumFlashsale" NOT NULL,
    "typeIds" JSONB DEFAULT '[]',

    CONSTRAINT "flashsale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "description" VARCHAR(255),
    "userId" INTEGER,
    "typeId" INTEGER NOT NULL,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "typestag" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "description" VARCHAR(255),
    "required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "typestag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvemember" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "memberId" INTEGER,
    "voucherIds" JSONB DEFAULT '[]',
    "productIds" JSONB DEFAULT '[]',

    CONSTRAINT "approvemember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tier" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "upgradePoint" DOUBLE PRECISION,
    "name" VARCHAR(255),
    "activeImage" VARCHAR(255),
    "inactiveImage" VARCHAR(255),

    CONSTRAINT "tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transaction" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "totalAmmount" DOUBLE PRECISION,
    "customer" INTEGER NOT NULL,
    "paymentMethod" "PaymentMethodEnum",
    "code" TEXT,
    "partner" TEXT,
    "status" "PaymentStatusEnum",
    "ipn" JSONB DEFAULT '{}',
    "ipnAt" BIGINT,
    "error_code" TEXT,
    "transactionId" TEXT,
    "vttTransactionId" TEXT,
    "refundTransId" TEXT,
    "refundStatus" TEXT,
    "timeout" BIGINT,
    "processTimeoutStatus" "PaymentProcessTimeoutStatusEnum" DEFAULT 'none',
    "lastQueryAt" BIGINT,
    "lastQuery" JSONB DEFAULT '{}',
    "retry" INTEGER DEFAULT 0,

    CONSTRAINT "payment_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "position" INTEGER,
    "isActive" BOOLEAN DEFAULT true,
    "voucherIds" JSONB NOT NULL DEFAULT '[]',
    "pinVoucherIds" JSONB NOT NULL DEFAULT '[]',
    "icon" VARCHAR(255),
    "type" "BlockType" NOT NULL,
    "isIntegration" BOOLEAN NOT NULL DEFAULT false,
    "datasetId" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 500,
    "limitUser" INTEGER,

    CONSTRAINT "block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "data" JSONB NOT NULL DEFAULT '[]',
    "type" "DatasetType" NOT NULL,
    "isActive" BOOLEAN DEFAULT true,

    CONSTRAINT "dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flashsale_voucher" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "description" TEXT,
    "dayFlashSale" TEXT NOT NULL,
    "timeFrameFlashSaleId" INTEGER NOT NULL,
    "startTime" BIGINT NOT NULL,
    "endTime" BIGINT NOT NULL,
    "isActive" BOOLEAN DEFAULT true,
    "year" INTEGER,

    CONSTRAINT "flashsale_voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flashsale_voucher_detail" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "voucherId" INTEGER NOT NULL,
    "flashSaleVoucherId" INTEGER NOT NULL,
    "isActive" BOOLEAN DEFAULT true,
    "timeFrameFlashSaleId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "normalPrice" DOUBLE PRECISION,
    "salePrice" DOUBLE PRECISION,
    "sequence" INTEGER DEFAULT 0,
    "startTime" BIGINT NOT NULL,
    "endTime" BIGINT NOT NULL,
    "percent" INTEGER,
    "quantity" INTEGER,
    "statusOfParent" "StatusOfParent" DEFAULT 'active',

    CONSTRAINT "flashsale_voucher_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_frame_flash_sale" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,
    "isActive" BOOLEAN DEFAULT true,

    CONSTRAINT "time_frame_flash_sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "position" INTEGER,
    "isActive" BOOLEAN DEFAULT true,
    "voucherIds" JSONB NOT NULL DEFAULT '[]',
    "image" VARCHAR(255),
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "icon" VARCHAR(255),

    CONSTRAINT "collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnerlike" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "partnerId" INTEGER,
    "firstLike" BOOLEAN DEFAULT false,

    CONSTRAINT "partnerlike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "code" VARCHAR(255),
    "type" VARCHAR(255),
    "minValueOfOrder" INTEGER DEFAULT 0,
    "maxValueOfOrder" INTEGER DEFAULT 0,
    "maxValueDiscount" INTEGER DEFAULT 0,
    "value" INTEGER DEFAULT 0,
    "customerId" INTEGER,
    "used" BOOLEAN DEFAULT false,
    "startDate" BIGINT DEFAULT 0,
    "expiredAt" BIGINT,
    "usedAt" BIGINT,
    "codeRequestId" INTEGER,
    "onlyUsed" "onlyUsedType" DEFAULT 'all',
    "storeId" INTEGER DEFAULT 0,
    "name" VARCHAR(255),
    "productIds" JSONB NOT NULL DEFAULT '[]',
    "voucherIds" JSONB DEFAULT '[]',
    "isDiscountPublic" BOOLEAN DEFAULT false,

    CONSTRAINT "discount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discountpublictransaction" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "code" VARCHAR(255),
    "countUsed" INTEGER DEFAULT 1,

    CONSTRAINT "discountpublictransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discountpublic" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "limitUserProgram" INTEGER DEFAULT -1,
    "code" VARCHAR(255),
    "limitProgram" INTEGER DEFAULT -1,

    CONSTRAINT "discountpublic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "state" BOOLEAN DEFAULT true,
    "description" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logo" TEXT,

    CONSTRAINT "provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "basic_auth" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "state" BOOLEAN DEFAULT true,
    "username" TEXT,
    "password" TEXT,
    "ip" TEXT,
    "auth" TEXT,

    CONSTRAINT "basic_auth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicetype" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "code" VARCHAR(50),
    "type" VARCHAR(50),
    "state" BOOLEAN DEFAULT true,
    "icon" TEXT,
    "background" TEXT,
    "tag" TEXT,
    "lineColor" VARCHAR(50),

    CONSTRAINT "servicetype_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_voucher" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "itemId" INTEGER,

    CONSTRAINT "group_voucher_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "code" ADD CONSTRAINT "code_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
