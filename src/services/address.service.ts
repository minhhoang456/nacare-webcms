import { prismaClient } from '@root/src/utils/prisma';
import redis from '../utils/redis';
// import geocodingService from "./geocoding.service";

export const addressService = {
  async bootstrap() {
    this.initCache();
    this.initLocationCache();
  },

  // Khởi tạo cache cho tất cả địa chỉ
  async initCache() {
    const addresses: any = await prismaClient.addressCustomer.findMany();
    const addressMap: any = addresses.reduce((acc: any, address: any) => {
      if (!acc[address.customerId]) {
        acc[address.customerId] = [];
      }
      acc[address.customerId].push(address);
      return acc;
    }, {});

    for (const [customerId, addresses] of Object.entries(addressMap)) {
      await redis.set(
        `addresses_customer:${customerId}`,
        JSON.stringify(addresses)
      );
    }
  },

  // Khởi tạo cache cho bảng ward, district, và province
  async initLocationCache() {
    const wards = await prismaClient.ward.findMany();
    const districts = await prismaClient.district.findMany();
    const provinces = await prismaClient.province.findMany();

    await redis.set('wards', JSON.stringify(wards));
    await redis.set('districts', JSON.stringify(districts));
    await redis.set('provinces', JSON.stringify(provinces));
  },

  // Lấy địa chỉ theo customerID
  async getAddressesByCustomerId(customerId: number) {
    const cachedAddresses = await redis.get(`addresses_customer:${customerId}`);
    if (cachedAddresses) {
      return JSON.parse(cachedAddresses);
    }

    const addresses = await prismaClient.addressCustomer.findMany({
      where: { customerId },
    });
    await redis.set(
      `addresses_customer:${customerId}`,
      JSON.stringify(addresses)
    );
    return addresses;
  },

  async updateAddress(
    customerId: number,
    addressData: any,
    action: 'create' | 'update' | 'delete'
  ) {
    var updatedAddress: any;

    // Lấy lat và lng từ địa chỉ
    if (action === 'create' || action === 'update') {
      if (addressData.isDefault === true) {
        await prismaClient.addressCustomer.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }
    }

    switch (action) {
      case 'create':
        updatedAddress = await prismaClient.addressCustomer.create({
          data: addressData,
        });
        break;
      case 'update':
        updatedAddress = await prismaClient.addressCustomer.update({
          where: { id: addressData.id },
          data: addressData,
        });
        break;
      case 'delete':
        updatedAddress = await prismaClient.addressCustomer.delete({
          where: { id: addressData.id },
        });
        break;
    }

    // Cập nhật cache
    const cachedAddresses = await redis.get(`addresses_customer:${customerId}`);
    let addresses: any = cachedAddresses ? JSON.parse(cachedAddresses) : [];

    if (action === 'create') {
      if (addressData.isDefault) {
        addresses = addresses.map((addr: any) => ({
          ...addr,
          isDefault: false,
        }));
      }
      addresses.push(updatedAddress);
    } else if (action === 'update') {
      if (addressData.isDefault) {
        addresses = addresses.map((addr: any) => ({
          ...addr,
          isDefault: addr.id === updatedAddress.id,
        }));
      }
      addresses = addresses.map((addr: any) =>
        addr.id === updatedAddress.id ? updatedAddress : addr
      );
    } else if (action === 'delete') {
      addresses = addresses.filter(
        (addr: any) => addr.id !== updatedAddress.id
      );
    }

    await redis.set(
      `addresses_customer:${customerId}`,
      JSON.stringify(addresses)
    );

    return addresses;
  },
};

export default addressService;
