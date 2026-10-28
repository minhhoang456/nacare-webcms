import axios, { RawAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import Conf from '../services/conf';
import messagequeueService from '../services/messagequeue';

async function request(options: RawAxiosRequestConfig) {
  if (typeof options?.data === 'string') {
    try {
      const parsedData = JSON.parse(options.data);
      options.data = parsedData;
    } catch (error) {}
  }
  options.validateStatus = (status) => {
    return status >= 200 && status < 300;
  };
  options.timeout = options.timeout
    ? options.timeout
    : Conf.get('TIMEOUT_REQUEST', 20000);
  const startTime = new Date().getTime();
  return axios(options)
    .then((resp: AxiosResponse) => {
      const data = resp.data;
      if (process.env.NODE_ENV === 'development') {
        messagequeueService.addDbItem({
          model: 'outgoing',
          action: 'create',
          data: {
            host: options.url,
            req: JSON.stringify(options),
            res: JSON.stringify(data),
            dur: new Date().getTime() - startTime,
          },
        });
      }
      return data;
    })
    .catch((err: AxiosError) => {
      let data = null;
      if (err.response) {
        data = err.response.data;
      } else {
        data = err;
      }
      if (process.env.NODE_ENV === 'development') {
        messagequeueService.addDbItem({
          model: 'outgoing',
          action: 'create',
          data: {
            host: options.url,
            req: JSON.stringify(options),
            res: JSON.stringify(data),
            dur: new Date().getTime() - startTime,
          },
        });
      } 
      throw data;
    });
}
export default request;
