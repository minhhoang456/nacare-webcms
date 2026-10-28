FROM node:18.18.0-alpine3.18 as builder
RUN apk add --update-cache ca-certificates python3 py3-pip \
    build-base \
    && pip3 install --ignore-installed virtualenv \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Install dependencies
COPY package.json yarn.lock ./
RUN yarn install

# Copy source
COPY . .

# Build and cleanup
ENV NODE_ENV=production
RUN yarn build
#
FROM node:18.18.0-alpine3.18
RUN apk add tzdata
# Set timezone
ENV TZ Asia/Ho_Chi_Minh

# Working directory
WORKDIR /app

# Install dependencies
COPY package.json yarn.lock ./
RUN yarn install --production

# Copy source
COPY --from=builder /app/dist ./dist
COPY assets ./assets
COPY prisma ./prisma
COPY static ./static

RUN yarn generate_db

# Build and cleanup
ENV NODE_ENV=production
# RUN yarn build

EXPOSE 7878

# Start server
CMD ["yarn", "start"]
