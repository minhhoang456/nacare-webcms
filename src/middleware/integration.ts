import Conf from '@src/services/conf';
import { FastifyReply, FastifyRequest } from 'fastify';
import { basicAuthService } from '../services';
import ono from '@jsdevtools/ono';

export default async function integrationMiddleware(
  req: FastifyRequest & {
    integrationId?: number;
    integrationName?: string;
  },
  res: FastifyReply
) {
  try {
    if (!req.headers.authorization) throw 'no auth';
    const [scheme, credentials] = req.headers.authorization.split(' ');
    if (scheme !== 'Basic') throw 'no auth';
    try {
      const decoded = Buffer.from(credentials, 'base64').toString('utf8');
      const [username, password] = decoded.split(':');
      const basic = await basicAuthService.getBasicAuth(username, password);
      if (!basic) throw 'no auth';
      let ipRequest = req.ip;
      if (ipRequest.startsWith('::ffff:')) {
        ipRequest = ipRequest.replace('::ffff:', '');
      }
      if (basic.ip !== '*' && basic.ip !== ipRequest) throw ono('ip_not_match');
      req.integrationId = basic.id;
      req.integrationName = basic.name;
    } catch (error: any) {
      switch (error.message) {
        case 'ip_not_match': {
          return res.code(401).send({
            code: 1,
            message: 'Lỗi xác thực. IP không được phép truy cập',
          });
          break;
        }
        default: {
          if (
            credentials !== Conf.get('VDS_SECRET', 'xclo27fkf2dqgh8q2vnbv728')
          ) {
            return res.code(401).send({
              code: 1,
              message: 'Lỗi xác thực',
            });
          }
        }
      }
    }
  } catch (error) {
    return res.code(401).send({
      code: 1,
      message: 'Lỗi xác thực',
    });
  }
}
