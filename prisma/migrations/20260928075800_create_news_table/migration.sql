-- CreateTable
CREATE TABLE "news" (
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    "id" SERIAL NOT NULL,
    "title" VARCHAR(255),
    "slug" VARCHAR(255),
    "thumbnail" VARCHAR(255),
    "content" TEXT,
    "category" VARCHAR(50),
    "publishedAt" BIGINT,
    "isActive" BOOLEAN DEFAULT true,

    CONSTRAINT "news_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "news_slug_key" ON "news"("slug");
