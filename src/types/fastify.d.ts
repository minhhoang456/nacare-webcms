import { OAuth2Namespace } from '@fastify/oauth2'

declare module '@fastify/oauth2' {
  interface FastifyOAuth2Options {
    name: string;
    scope?: string[];
    credentials: {
      client: {
        id: string;
        secret: string;
      };
      auth: typeof OAuth2Namespace.GOOGLE_CONFIGURATION;
    };
    startRedirectPath?: string;
    callbackUri: string;
    pkce?: 'S256' | 'plain';
    cookie?: {
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: 'strict' | 'lax' | 'none';
    };
    callbackUriParams?: Record<string, string>;
    tags?: string[];
    schema?: {
      tags?: string[];
      summary?: string;
      description?: string;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    googleOAuth2: OAuth2Namespace;
    facebookOAuth2: OAuth2Namespace;
  }
} 