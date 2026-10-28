import redis from '../utils/redis';
import { AddressSearch } from 'dangnh-search-lib';

const addressSearch = new AddressSearch({
  locationIQKey: '',
  googleOptions: {},
  mapboxKey:
    '',
});

export const geocodingService = {
  getLatLongFromAddress: async (address: string) => {
    try {
      if (!address) throw new Error('no_address');
      const cachedResult = await redis.get(`geocode:${address}`);
      if (cachedResult) {
        return {
          data: JSON.parse(cachedResult),
        };
      }
      const { data } = await searchAddress(address);
      if (data && data.length > 0) {
        await redis.set(`geocode:${address}`, JSON.stringify(data), 'EX', 300);
        return {
          data,
        };
      } else {
        return null;
      }
    } catch (error: any) {
      console.error('Error:', error.message);
      return null;
    }
  },
};
export default geocodingService;

async function searchAddress(address: string) {
  const providers: string[] = ['pton', 'iq', 'nomi'];
  const result = await Promise.race(
    providers.map(async (provider) => {
      const data = await addressSearch.search(address, provider as any);
      if (data && data.length > 0) {
        return { data, provider };
      }
      throw new Error(`No results from ${provider}`);
    })
  );
  return result;
}
